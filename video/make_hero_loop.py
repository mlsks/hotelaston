"""
Boucle « aller-retour » ralentie et sans raccord pour les vidéos du Hero.

1. ffmpeg minterpolate : 24 fps -> 96 fps (images intermédiaires par compensation de mouvement)
2. Profil temporel : vitesse 0,5x constante, rampes cosinus de `EASE` s aux extrémités
   (la caméra ralentit, s'arrête, repart en sens inverse : vitesse et accélération continues)
3. Les images de sortie (24 fps) mélangent les deux images denses voisines -> aucun à-coup
4. Étalonnage à l'encodage : courbe en S douce (contraste des tons moyens), vibrance
   (saturation qui épargne les couleurs déjà vives), netteté CAS ; agrandissement Lanczos optionnel
5. Encodage H.264 (faststart, sans audio)

usage : python make_hero_loop.py <entrée.mp4> <sortie.mp4> <dossier_travail> [crf] [largeur:hauteur]
"""
import math
import os
import subprocess
import sys

import cv2
import numpy as np

SRC, OUT, WORK = sys.argv[1], sys.argv[2], sys.argv[3]
CRF = sys.argv[4] if len(sys.argv) > 4 else "23"
SIZE = sys.argv[5] if len(sys.argv) > 5 else None   # ex. 1920:1080 (agrandissement Lanczos)
GRADE = ",".join(filter(None, [
    f"scale={SIZE}:flags=lanczos" if SIZE else None,
    "curves=all='0/0 0.16/0.13 0.5/0.5 0.84/0.875 1/1'",  # S douce : la source tasse ses tons moyens
    "vibrance=intensity=0.25",
    "cas=strength=0.65",
]))
FPS = 24          # fps de la source et de la sortie
DENSE = 4         # facteur d'interpolation (96 fps)
SPEED = 0.5       # 2x plus lent
EASE = 2.5        # secondes de décélération / accélération à chaque extrémité

os.makedirs(WORK, exist_ok=True)
if not any(f.startswith("d_") for f in os.listdir(WORK)):  # images denses réutilisées si déjà calculées
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-i", SRC, "-an",
        "-vf", f"minterpolate=fps={FPS * DENSE}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:me=epzs:vsbmc=1:scd=none",
        "-q:v", "2", os.path.join(WORK, "d_%05d.jpg"),
    ], check=True)

frames = sorted(f for f in os.listdir(WORK) if f.startswith("d_"))
# minterpolate rend quelques images de moins que la source : la course s'arrête à la dernière
# image dense réelle, sinon la caméra resterait figée au demi-tour
L = (len(frames) - 1) / (FPS * DENSE)       # durée parcourue dans la source (s)
T_FRAMES = round((L / SPEED + EASE) * FPS)  # demi-cycle en images de sortie
T = T_FRAMES / FPS
v0 = L / (T - EASE)                         # ~0,5 : aire du profil = L exactement


def s_half(u):
    """Temps source (s) atteint après u secondes de demi-cycle, profil trapèze à rampes cosinus."""
    if u <= EASE:
        return v0 * (u / 2 - EASE / (2 * math.pi) * math.sin(math.pi * u / EASE))
    if u <= T - EASE:
        return v0 * EASE / 2 + v0 * (u - EASE)
    return L - s_half(T - u)


cache = {}


def dense(i):
    i = max(0, min(len(frames) - 1, i))
    if i not in cache:
        if len(cache) > 64:
            cache.pop(next(iter(cache)))
        cache[i] = cv2.imread(os.path.join(WORK, frames[i])).astype(np.float32)
    return cache[i]


h, w = dense(0).shape[:2]
total = 2 * T_FRAMES
# Une seule image clé par cycle (sans détection de coupe) : chaque image clé provoque un
# léger saut de netteté, très visible quand la caméra est presque immobile.
enc = subprocess.Popen([
    "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
    "-r", str(FPS), "-i", "-", "-an", "-vf", GRADE, "-c:v", "libx264", "-preset", "slow", "-crf", CRF,
    "-tune", "film", "-x264-params", f"keyint={total}:min-keyint={total}:scenecut=0{os.environ.get('X264_EXTRA', '')}",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT,
], stdin=subprocess.PIPE)

# Le cycle démarre au milieu de l'aller (vitesse constante) : la jonction de boucle et
# l'unique image clé tombent en plein mouvement, là où elles sont imperceptibles.
start = T / 2
for k in range(total):
    u = (k / FPS + start) % (2 * T)
    s = s_half(u) if u <= T else s_half(2 * T - u)   # aller puis retour
    x = s * FPS * DENSE
    i = int(math.floor(x))
    a = x - i
    img = dense(i) if a < 1e-3 else dense(i) * (1 - a) + dense(i + 1) * a
    enc.stdin.write(np.clip(img + 0.5, 0, 255).astype(np.uint8).tobytes())
enc.stdin.close()
enc.wait()

print(f"{os.path.basename(OUT)} : {total} images, {total / FPS:.2f} s, vitesse {v0:.3f}x, "
      f"{os.path.getsize(OUT) / 1e6:.2f} Mo")
