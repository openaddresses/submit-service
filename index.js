const _ = require('lodash');

try {
  if (_.isEmpty(process.env.GITHUB_ACCESS_TOKEN)) {
    throw Error('GITHUB_ACCESS_TOKEN is required');
  }
  if (_.isEmpty(process.env.AWS_ACCESS_KEY_ID)) {
    throw Error('AWS_ACCESS_KEY_ID is required');
  }
  if (_.isEmpty(process.env.AWS_SECRET_ACCESS_KEY)) {
    throw Error('AWS_SECRET_ACCESS_KEY is required');
  }

  const app = require('./app')();

  const port = ( parseInt(process.env.PORT) || 3103 );

  app.listen(port, () => {
    console.log(`submit-service is now running on port ${port}`);
  });

} catch (err) {
  console.error(err.toString());
  process.exit(1);

}
