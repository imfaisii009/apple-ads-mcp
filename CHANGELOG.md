# Changelog

## 1.0.0

- First release.
- Full Apple Ads Platform API surface exposed through 4 meta-tools:
  `ads_search`, `ads_schema`, `ads_call`, `ads_tags`.
- OAuth 2.0 client-credentials auth with an ES256 client-secret JWT, matching
  Apple's official client libraries.
- Automatic `X-Ap-Context` ad account scoping from `APPLE_ADS_ORG_ID` or a
  per-call `adAccountId`.
