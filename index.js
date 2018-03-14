const _ = require('lodash');

try {
  const app = require('./app');

  const port = ( parseInt(process.env.PORT) || 3103 );

  app.listen(port, () => {
    console.log(`submit-service is now running on port ${port}`);
  });

} catch (err) {
  console.error(err.toString());
  process.exit(1);

}
