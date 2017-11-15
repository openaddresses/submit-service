FROM node:8-alpine

# Where the app is built and run inside the docker fs
ENV WORK=/opt/pelias

# Used indirectly for saving npm logs etc.
ENV HOME=/opt/pelias

WORKDIR ${WORK}

COPY package.json ${WORK}

RUN npm install

COPY . ${WORK}

CMD node index.js
