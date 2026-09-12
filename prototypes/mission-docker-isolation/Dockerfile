FROM node:24-alpine
RUN addgroup -S -g 65532 mission \
  && adduser -S -D -H -u 65532 -G mission mission
WORKDIR /prototype
COPY --chown=65532:65532 src/mission.mjs ./src/mission.mjs
USER 65532:65532
ENTRYPOINT ["node", "/prototype/src/mission.mjs"]
