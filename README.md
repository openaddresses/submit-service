# OpenAddress Submit Service

[![Greenkeeper badge](https://badges.greenkeeper.io/openaddresses/submit-service.svg)](https://greenkeeper.io/)

This project provides an HTTP service that can be used to back a website that makes submitting new data sources to OpenAddresses easier for those unfamiliar with JSON and github.

## Usage

While the service can be run directly from node, the preferred method is docker.

To run using docker, enter:

```bash
$ docker-compose up
```

The service starts on [http://localhost:3103](http://localhost:3103) (unless the port is overridden).

### Credentials

This service performs operations on github and uploads file to s3, so the credentials for both of these services must be available in the docker environment.  Docker uses the .env file to store these values.  For security concerns, the .env file is not stored in the git repository and must be populated before running docker.  A sample .env file is:

```bash
GITHUB_ACCESS_TOKEN=<github access token>
AWS_ACCESS_KEY_ID=<AWS access key id>
AWS_SECRET_ACCESS_KEY=<AWS secret access key>
```

## Endpoints

The service exposes two endpoints for programmatic access:

- `/sample`: looks up the field names and first 10 records from a source
- `/submit`: submits a pull request to the OpenAddresses repo
- `/upload`: uploads a file to be hosted by the OpenAddresses S3 bucket

### `/sample`

The `/sample` endpoint accepts a single parameter named `source`.  The response format is the basic shell of an OpenAddresses source, for example [York County, PA, USA](http://arcweb.ycpc.org/arcgis/rest/services/Emergency_Services/Address_Pts/MapServer/0).  

An example response from the `/sample` endpoint is:

```json
{
  "coverage": {},
  "type": "ESRI",
  "data": "http://arcweb.ycpc.org/arcgis/rest/services/Emergency_Services/Address_Pts/MapServer/0",
  "conform": {
    "type": "geojson"
  },
  "note": "",
  "source_data": {
    "fields": ["id", "number", "street", "city"],
    "results": [
      {
        "id": "1001",
        "number": "123",
        "street": "Main Street",
	"city": "Anytwn"
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

- `type`: (either `ESRI`, `http`, or `ftp`)
- `conform.type`: (one of `geojson`, `csv`, or `shapefile`)
- `compression`: (`zip` if source is a .zip file)
- `data` (the value of the `source` parameter)

#### Error Conditions

`/sample` returns an HTTP status 400 in the following error conditions:

- no `source` parameter is supplied
- the `source` parameter value contains an unsupported file type
- the `source` parameter value cannot be parsed as a URL
- the ArcGIS source request has failed
- the .csv file cannot be parsed (either standalone or contained within a .zip file)
- the .geojson file cannot be parsed (either standalone or contained within a .zip file)
- the HTTP or FTP server cannot be contacted
- the resource does not exist on the HTTP or FTP server
- the .zip file cannot be parsed
- the .zip file does not contain a .csv, .geojson, or .dbf file

### `/submit`

The `/submit` endpoint is available to create pull requests in the [OpenAddresses github repository](https://github.com/openaddresses/openaddresses).  It accepts POST requests and takes a single parameter named `source` that
is a JSON blob that conforms to the OpenAddresses [source schema](https://github.com/openaddresses/openaddresses/blob/master/schema/source_schema.json).  

The response, if successful, is a JSON blob containing the [OpenAddresses pull request](https://github.com/openaddresses/openaddresses/pulls) URL, for example:

```json
{
  "response": {
    "url": "https://github.com/openaddresses/openaddresses/pull/3746"
  }
}
```

Since programmatically assigning a unique name based on the input is very difficult, the `/submit` endpoint creates a unique name based on random numbers.  

#### Error Conditions

`/submit` supports the following error conditions:

- HTTP status 500 with a message is returned if any Github API operations occur (meaning that credentials have most likely be entered incorrectly)
- HTTP status 400 with a message is returned if the `source` parameter value does not conform to the OpenAddresses [source schema](https://github.com/openaddresses/openaddresses/blob/master/schema/source_schema.json)

### `/upload`

The `/upload` endpoint is available to upload data sources that require hosting by uploading to the OpenAddresses AWS S3 bucket.  The only available parameter is named `datafile`.  Upon successful upload to the OpenAddresses AWS S3 bucket, an HTTP status 302 (redirect) is returned with the target being the `/sample` endpoint complete with `source` parameter supplied.  

Since programmatically assigning a unique name based on the input is very difficult, the `/submit` endpoint creates a unique name based on random numbers.  

#### Error Conditions

`/upload` supports the following error conditions:

- HTTP status 500 with a message is returned if any AWS S3 API operations occur (meaning that credentials have most likely be entered incorrectly)
- HTTP status 400 with a message is returned for the following scenarios:
  - the `datafile` parameter was not supplied
  - the uploaded file extension is not one of `.zip`, `.csv`, or `.geojson`
  - the uploaded file size is greater than 50MB

## Supported Types

There are several supported source types:

- ESRI/Arcgis
- CSV (optionally .zip compressed)
- GeoJSON (optionally .zip compressed)
- Shapefiles (.zip compressed)

## Development

### Local Testing

For local testing, the service also provides a [UI](http://localhost:3103/) that can query the service and display the output in HTML.

### Running Unit Tests

```bash
$ npm test
```

## Production

The OpenAddresses Submit Service has been developed in such a way that it is stateless and can be run either locally or via AWS Lambdas using the API Gateway for request proxying.  [Claudia](https://claudiajs.com) is utilized for generating and deploying to AWS Lambdas + API Gateway.  The configuration is in place for this so to update the Lambda functions, [install claudia.js](https://claudiajs.com/tutorials/installing.html), ensure that `.aws/credentials` contains a `[claudia]` section with credentials for a deploy-capable user, and enter:

```bash
$ claudia update --handler lambda.handler --deploy-proxy-api --region us-east-1
```

The Submit Service API can be accessed on the `/sample`, `/upload`, and `/submit` endpoints using https://hewcawyvc4.execute-api.us-east-1.amazonaws.com/latest/.  

## Contributing

Please fork and pull request against upstream master on a feature branch.

Provide unit tests in the `test` directory.

## Continuous Integration

Travis tests every release against Node.js version `8`.

[![Build Status](https://travis-ci.org/openaddresses/submit-service.png?branch=master)](https://travis-ci.org/openaddresses/submit-service)
