# 在最老要支持的系统上跑测试：Ubuntu 20.04，自带 git 2.25.1（`DECISIONS.md`「最低 git 版本」）。
# node 从官方镜像拷进来：apt 里的太老，跑不了 vitest。
FROM node:24-bookworm-slim AS node

FROM ubuntu:20.04
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git gnupg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
