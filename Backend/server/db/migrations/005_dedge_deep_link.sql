-- 005 — lien profond D-Edge (28/10/2026) : la page des chambres s'ouvre sur les dates, le nombre
-- d'adultes et d'enfants du visiteur. Ne touche pas une adresse du moteur déjà modifiée dans les Réglages.

UPDATE cms_settings
SET value = json_set(value,
      '$.base', 'https://www.secure-hotel-booking.com/d-edge/redirect/2ARI/19552/{locale}/RoomSelection?currency=EUR',
      '$.params', json('{"checkin":"arrivalDate","checkout":"departureDate","nights":null,"adults":"selectedAdultCount","children":"selectedChildCount","guests":null,"roomType":null,"offerId":null}')),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'booking_engine'
  AND json_extract(value, '$.base') = 'https://www.secure-hotel-booking.com/smart/redirect/2ARI-19552/{lang}/'
  AND json_extract(value, '$.params') IS NULL;
