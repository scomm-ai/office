# Office host: device enrollment

The Outlook add-in consumes `@scomm/pubkey` enrollment APIs. It does not
implement a separate cryptographic protocol.

- New identity: create MSK, OTP arm, authorize this Outlook installation as
  the first device.
- Existing identity: transfer via pairing code, or explicit identity recovery.
- Outlook cannot reliably scan a camera QR; the new device shows a paste code.
