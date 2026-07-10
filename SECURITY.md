# Security policy

Security fixes target the current `main` branch and the currently deployed production revision.

Do not publish exploitable account, economy, authentication, duplication, or remote-code-execution details in a public issue. Prefer GitHub Private Vulnerability Reporting for this repository. If it is unavailable, contact the repository owner privately and include the affected revision, reproduction steps, impact, and any temporary mitigation.

Never include real JWT secrets, Railway variables, database URLs, access tokens, player credentials, or production data in a report. Test with a newly created account and the smallest reproducible payload.

The maintainer should acknowledge a complete report, assess severity, prepare a private fix, rotate exposed credentials when applicable, and publish a concise advisory after the patched revision is deployed.
