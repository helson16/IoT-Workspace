# ---- Stage 1: Runtimes ----
FROM node:24-slim AS node-runtime

FROM python:3.13-slim AS python-runtime

# ---- Stage 2: Dev Container ----
FROM node:24-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget ca-certificates gnupg lsb-release \
    sqlite3 python3 python3-pip python3-venv \
    zsh fonts-powerline fonts-fontawesome \
    && rm -rf /var/lib/apt/lists/*

# Copy Python runtime
COPY --from=python-runtime /usr/local/bin/python3 /usr/local/bin/python3
COPY --from=python-runtime /usr/local/bin/pip3 /usr/local/bin/pip3
COPY --from=python-runtime /usr/local/lib/python3.13 /usr/local/lib/python3.13

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install just (task runner, Harness-style)
RUN curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to /usr/local/bin

# Install zsh plugins
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended \
    && git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions \
    && git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# Set zsh as default
SHELL ["/bin/zsh", "-c"]
ENV SHELL=/bin/zsh

# Working directory
WORKDIR /workspace

# Post-create command
CMD ["sleep", "infinity"]
