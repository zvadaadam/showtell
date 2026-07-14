# Security policy

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** form in the repository Security
tab. Do not open a public issue for a suspected vulnerability. Include affected
versions, impact, reproduction steps, and any suggested mitigation. You should
receive an acknowledgement within seven days.

Security fixes are supported for the latest published version.

## Trusted-code boundary

Showtell specs are data, but bundle `hyperframes/*.html` files contain
executable JavaScript. Showtell runs them in a pinned browser with static policy
validation, a content security policy, blocked network requests, and guards for
nondeterministic APIs. Those controls enforce the authoring contract; they do
not make the browser a hostile-code sandbox. Review HyperFrames before
rendering them, and do not render bundles from untrusted sources.

Repository file references and declared assets are constrained, validated, and
resolved by the renderer rather than by authored browser code: refs cannot
escape the declared repository root, and bundle files cannot escape the bundle
directory. The repository root itself (`meta.repo.path`) is trusted spec input
and may point anywhere on disk, which is another reason to review bundles from
unfamiliar sources before rendering. These protections reduce the visual
runtime's authority, but they do not make arbitrary HTML and JavaScript safe.
