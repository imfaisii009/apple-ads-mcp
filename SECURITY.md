# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email the maintainer
or use GitHub's private vulnerability reporting on this repository. You will
get a reply within a few days.

## Credentials

This server never bundles credentials. Everything is read from the
environment at runtime:

- `APPLE_ADS_CLIENT_ID`, `APPLE_ADS_TEAM_ID`, `APPLE_ADS_KEY_ID`
- `APPLE_ADS_PRIVATE_KEY_PATH` or `APPLE_ADS_PRIVATE_KEY`

Your Apple Ads private key signs a client-secret JWT that can be valid for up
to 180 days, so treat the `.p8` file like a password:

- Keep it outside the repository, or rely on the `.gitignore` rules that
  already exclude `*.p8`, `*.pem` and `.env`.
- Never paste the key or an access token into an issue, a log, or a chat.
- Rotate the key in the Apple Ads UI if you think it leaked.

The server logs to stderr only, and never logs key material or tokens.
