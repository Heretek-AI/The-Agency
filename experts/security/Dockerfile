# Security expert image (Stage 1b).
# FROM the pinned base image; scanner toolchain and the security MCP
# servers at pinned versions. This expert is read-only: it finds and
# explains problems and never patches. Every version pinned; see
# versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="security"
USER root
# semgrep and checkov (PyPI, pinned).
RUN uv pip install --system --break-system-packages semgrep==1.180.0 checkov==3.3.29 \
  && semgrep --version \
  && checkov --version
# trivy 0.75.0 (GitHub release, sha256 checked) plus its MCP plugin at a
# pinned version, installed as the agent user that will run it.
RUN curl -fsSL -o /tmp/trivy.tar.gz \
      "https://github.com/aquasecurity/trivy/releases/download/v0.75.0/trivy_0.75.0_Linux-64bit.tar.gz" \
  && echo "c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f  /tmp/trivy.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/trivy.tar.gz -C /tmp \
  && install -m755 /tmp/trivy /usr/local/bin/trivy \
  && rm -rf /tmp/trivy.tar.gz /tmp/trivy /tmp/contrib /tmp/LICENSE /tmp/README.md \
  && trivy --version
USER agent
RUN trivy plugin install mcp@v0.0.20
USER root
# gitleaks v8.30.1 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/gitleaks.tar.gz \
      "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz" \
  && echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  /tmp/gitleaks.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/gitleaks.tar.gz -C /tmp \
  && install -m755 /tmp/gitleaks /usr/local/bin/gitleaks \
  && rm -rf /tmp/gitleaks.tar.gz /tmp/gitleaks \
  && gitleaks version
# osv-scanner v2.7.0 (GitHub release, sha256 checked).
RUN curl -fsSL -o /usr/local/bin/osv-scanner \
      "https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_linux_amd64" \
  && echo "160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b  /usr/local/bin/osv-scanner" | sha256sum -c - \
  && chmod 755 /usr/local/bin/osv-scanner \
  && osv-scanner --version
# syft v1.54.1 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/syft.tar.gz \
      "https://github.com/anchore/syft/releases/download/v1.54.1/syft_1.54.1_linux_amd64.tar.gz" \
  && echo "c069905b391cc4c20a5ba65ad5c10be2a7ba074f8ea6ad203e24d14e303dad47  /tmp/syft.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/syft.tar.gz -C /tmp \
  && install -m755 /tmp/syft /usr/local/bin/syft \
  && rm -rf /tmp/syft.tar.gz /tmp/syft \
  && syft --version
# grype v0.120.1 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/grype.tar.gz \
      "https://github.com/anchore/grype/releases/download/v0.120.1/grype_0.120.1_linux_amd64.tar.gz" \
  && echo "0a9ee97ef5ae2ee953b0a80098105052e846cdbe319a57d808b519c33cd1343d  /tmp/grype.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/grype.tar.gz -C /tmp \
  && install -m755 /tmp/grype /usr/local/bin/grype \
  && rm -rf /tmp/grype.tar.gz /tmp/grype \
  && grype --version
USER agent
