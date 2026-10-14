# Platform expert image (Stage 1b).
# FROM the pinned base image; delivery-definition linters, IaC CLIs, and
# the platform MCP servers at pinned versions. No container daemon runs
# here and none is reachable: image builds and stack runs happen in the
# environment runner via the Dispatcher. The Docker CLI is deliberately not
# installed (it would need the Docker apt repository and there is no socket
# for it to reach); Dockerfiles are linted with hadolint instead.
# Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="platform"
USER root
# Shell/YAML linters (apt, pinned).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       shellcheck=0.9.0-1 \
       shfmt=3.8.0-1 \
       yamllint=1.33.0-1 \
  && rm -rf /var/lib/apt/lists/* \
  && shellcheck --version \
  && shfmt --version \
  && yamllint --version
# hadolint v2.15.1 (GitHub release, sha256 checked).
RUN curl -fsSL -o /usr/local/bin/hadolint \
      "https://github.com/hadolint/hadolint/releases/download/v2.15.1/hadolint-linux-x86_64" \
  && echo "c7187db94eeeeca956519a6af171adc31453941a1e777961f6e680f697c8c507  /usr/local/bin/hadolint" | sha256sum -c - \
  && chmod 755 /usr/local/bin/hadolint \
  && hadolint --version
# actionlint v1.7.12 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/actionlint.tar.gz \
      "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz" \
  && echo "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  /tmp/actionlint.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/actionlint.tar.gz -C /tmp \
  && install -m755 /tmp/actionlint /usr/local/bin/actionlint \
  && rm -rf /tmp/actionlint.tar.gz /tmp/actionlint \
  && actionlint --version
# tflint v0.64.0 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/tflint.zip \
      "https://github.com/terraform-linters/tflint/releases/download/v0.64.0/tflint_linux_amd64.zip" \
  && echo "cca9d13e2e1d7a2c627af60ff899a3c9b74212899416aeb96ec764d2ef954537  /tmp/tflint.zip" | sha256sum -c - \
  && unzip -o -q /tmp/tflint.zip -d /tmp/tflint \
  && install -m755 /tmp/tflint/tflint /usr/local/bin/tflint \
  && rm -rf /tmp/tflint.zip /tmp/tflint \
  && tflint --version
# terraform 1.16.5 (HashiCorp release, hash matches upstream SHA256SUMS).
RUN curl -fsSL -o /tmp/terraform.zip \
      "https://releases.hashicorp.com/terraform/1.16.5/terraform_1.16.5_linux_amd64.zip" \
  && echo "2bc2fcfff033265c9e02ca0351f01794eb122f62a9b2a49a3294b9e49eaab5e4  /tmp/terraform.zip" | sha256sum -c - \
  && unzip -o -q /tmp/terraform.zip -d /tmp/terraform \
  && install -m755 /tmp/terraform/terraform /usr/local/bin/terraform \
  && rm -rf /tmp/terraform.zip /tmp/terraform \
  && terraform version
# terraform-mcp-server 1.3.0 (HashiCorp release, hash matches upstream
# SHA256SUMS). ENABLE_TF_OPERATIONS is never set, so plan/apply stay off.
RUN curl -fsSL -o /tmp/terraform-mcp-server.zip \
      "https://releases.hashicorp.com/terraform-mcp-server/1.3.0/terraform-mcp-server_1.3.0_linux_amd64.zip" \
  && echo "f8ecdbfb8473af4d54f6ca428de59649ff4c74f1c8a904da1c2973fa345d4d26  /tmp/terraform-mcp-server.zip" | sha256sum -c - \
  && unzip -o -q /tmp/terraform-mcp-server.zip -d /tmp/terraform-mcp-server \
  && install -m755 /tmp/terraform-mcp-server/terraform-mcp-server /usr/local/bin/terraform-mcp-server \
  && rm -rf /tmp/terraform-mcp-server.zip /tmp/terraform-mcp-server \
  && terraform-mcp-server --help >/dev/null
# kubectl v1.37.1 (dl.k8s.io, hash matches upstream .sha256).
RUN curl -fsSL -o /usr/local/bin/kubectl \
      "https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl" \
  && echo "65691ff77eb6fa44c908b77a1082c9f092c3b9733b5cefabec0d1104890e21a8  /usr/local/bin/kubectl" | sha256sum -c - \
  && chmod 755 /usr/local/bin/kubectl \
  && kubectl version --client
# helm v4.3.0 (get.helm.sh, sha256 checked).
RUN curl -fsSL -o /tmp/helm.tar.gz \
      "https://get.helm.sh/helm-v4.3.0-linux-amd64.tar.gz" \
  && echo "86584a54def73570558f66f5111cc53dfed56689637ae32c1201205d494f54fb  /tmp/helm.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/helm.tar.gz -C /tmp \
  && install -m755 /tmp/linux-amd64/helm /usr/local/bin/helm \
  && rm -rf /tmp/helm.tar.gz /tmp/linux-amd64 \
  && helm version
# kustomize v5.8.3 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/kustomize.tar.gz \
      "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv5.8.3/kustomize_v5.8.3_linux_amd64.tar.gz" \
  && echo "cb9e31198d3f63b44848bd0afc4c8efc56e6cfef9c93a4a39a211940e6decd61  /tmp/kustomize.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/kustomize.tar.gz -C /tmp \
  && install -m755 /tmp/kustomize /usr/local/bin/kustomize \
  && rm -rf /tmp/kustomize.tar.gz /tmp/kustomize \
  && kustomize version
# kubeconform v0.8.0 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/kubeconform.tar.gz \
      "https://github.com/yannh/kubeconform/releases/download/v0.8.0/kubeconform-linux-amd64.tar.gz" \
  && echo "9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883  /tmp/kubeconform.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/kubeconform.tar.gz -C /tmp \
  && install -m755 /tmp/kubeconform /usr/local/bin/kubeconform \
  && rm -rf /tmp/kubeconform.tar.gz /tmp/kubeconform \
  && kubeconform -v
# kubernetes MCP server (npm, pinned; ships disabled until a kubeconfig
# is mounted, but its binary is baked in now).
RUN npm install -g kubernetes-mcp-server@0.0.67 \
  && kubernetes-mcp-server --help >/dev/null 2>&1
USER agent
