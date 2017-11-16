# OpenAddress Submit Service

This project provides an HTTP service that can be used to back a website that makes submitting new data sources to OpenAddresses easier for those unfamiliar with JSON and github.


## Usage

The service can be run in two ways:

- Docker
- node.js

In either scenario, the service starts on [http://localhost:3103](http://localhost:3103) (unless the port is overridden).

### Docker

TBD

### node.js

To run using node.js and npm, simply enter the following to install dependencies and start the service:

```bash
$ npm install
$ npm start
```

By default, the service starts on port 3103, but this can be changed by setting the `PORT` environmental variable.

## Endpoints

The service exposes two endpoints for programmatic access:

- `/fields`: looks up the available fields and sample records from a source
- `/submit`: submits a pull request to the OpenAddresses repo

### `/fields`

The `/fields` endpoint accepts a single parameter named `source`.  The response format is the basic shell of an OpenAddresses source, for example [York County, PA, USA](http://arcweb.ycpc.org/arcgis/rest/services/Emergency_Services/Address_Pts/MapServer/0).  

An example response from the `/fields` endpoint is:

```json
{
	coverage: {},
	type: "http",
	compression: "zip",
	data: "http://https://s3.amazonaws.com/data.openaddresses.io/cache/uploads/file.csv.zip",
	conform: {
		type: "csv"
	},
	source_data: {
		fields: ["id", "number", "street", "city"],
		results: [
			{
				"id": "1001",
				"number": "123",
				"street": "Main Street",
				"city": "Anytown"
			},
			{
				"id": "1002",
				"number": "17",
				"street": "Maple Avenue",
				"city": "Somewheresville"
			}
		]
	}
}
```

The populated portions would be properties that can be inferred from the source:

- `type`: (either `ESRI` or `http`)
- `conform.type`: (one of `geojson` or `csv`)
- `compression`: (`zip` is source is a .zip file)
- `data` (the value of the `source` parameter)

### `/submit`

TBD

## Supported Types

There are several supported source types:

- ESRI/Arcgis
- CSV (optionally .zip compressed)
- GeoJSON (optionally .zip compressed)

## Development

### Local Testing

For local testing, the service also provides a [UI](http://localhost:3103/) that can query the service and display the output in HTML.

### Running Unit Tests

```bash
$ npm test
```


## Contributing

Please fork and pull request against upstream master on a feature branch.

Provide unit tests in the `test` directory.
