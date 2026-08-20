# Container image for craft-cloud-gateway RunAgent.
#
# Same base as cloudflare/computer's container example (computerd +
# FUSE at /workspace), plus the baked-in research runner that the
# RunDO executes per subtask. Runner is upgraded by redeploying the
# worker (image rebuild), not by writing through the workspace FS.
FROM ghcr.io/cloudflare/computer-computerd-linux-x64:0.1.0-alpha.1 AS computerd
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fuse3 libfuse2 ca-certificates curl gnupg git \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*
COPY --from=computerd /usr/local/bin/computerd /usr/local/bin/computerd
COPY src/runner.mjs /opt/craft-runner/runner.mjs
RUN npm install -g @marp-team/marp-cli@^4
# omp CLI (F21 variant) is NOT baked in: image size + QEMU-host builds said
# no. runner-omp.mjs installs it lazily into the container on first use
# (~30-60s once per container lifetime) and keeps the image slim.
COPY src/runner-omp.mjs /opt/craft-runner/runner-omp.mjs
ENV PORT=8080
ENV MOUNT_POINT=/workspace
ENV FUSE_MOUNT=auto
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/computerd"]
