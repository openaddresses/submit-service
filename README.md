# OpenAddress Submit Service

[![Greenkeeper badge](https://badges.greenkeeper.io/openaddresses/submit-service.svg)](https://greenkeeper.io/)

This project provides an HTTP service that can be used to back a website that makes submitting new data sources to OpenAddresses easier for those unfamiliar with JSON and github.

## Usage

While the service can be run directly from node and docker, the preferred method is by calling the AWS API Gateway URLs.

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
- `/createIssue`: creates an issue in the [OpenAddresses repo](https://github.com/openaddresses/openaddresses/issues)
- `/upload`: uploads a file to be hosted to the OpenAddresses S3 bucket
- `/sources`: 

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

### `/createIssue`

The `/createIssue` endpoint is used for creating GitHub issues in the OpenAddresses repository when the UI is unable to generate a source conform; for example, when the source requires regular expressions to parse correctly. 

The only method supported by `/createIssue` is POST and requests to this endpoint should contain the following properties formatted as JSON:

- `location`: the geographical area that the data represents
- `emailAddress`: the email address of the contact for questions regarding the data
- `dataUrl`: the URL of the hosted data
- `comments`: any contextual information about the data to aid in efforts to accurately ingest this data

An example POST body sent to the `/createIssue` endpoint would be: 

```json
{
  "location": "Null Island",
  "emailAddress": "DrNull@nullisland.com",
  "dataUrl": "http://nullisland.com/data/addresses.zip",
  "comments": "Data contains a *lot* of nulls, help!"
}
```

The response, if successful, is a JSON blob containing the [OpenAddresses issue](https://github.com/openaddresses/openaddresses/issues) URL, for example:

```json
{
  "response": {
    "url": "https://github.com/openaddresses/openaddresses/issues/3855"
  }
}
```

#### Error Conditions

`/createIssue` returns an HTTP status 400 and message if any of the following error conditions apply:

- no POST body parameter is supplied
- POST body is not parseable as JSON
- POST body does not contain all of the following fields:
  - `location`
  - `emailAddress`
  - `dataUrl`
  - `comments`

### `/sources`

The `/sources` endpoint returns all subfolders and .json files of a folder in the OpenAddress GitHub repository.  This endpoint should be used for navigation of the [sources](https://github.com/openaddresses/openaddresses/tree/master/sources) folder.  Only folders should be specified in the path.  Example request:

`https://68exp8ppy6.execute-api.us-east-1.amazonaws.com/latest/sources/de/`

This request would return (at the time of this documentation):

```json
{
  "folders": [
    "he",
    "hh",
    "mv",
    "ni",
    "nw",
    "sn",
    "th"
  ],
  "files": [
    "berlin.json"
  ]
}
```

To get the contents of an individual source, use the `/source` endpoint.  

#### Error Conditions

`/sources` supports the following error conditions:

- HTTP status 400 with a message is returned in the following scenarios:
  - the specified source does not exist
  - the specified source is a file

### `/maintainers`

The `/maintainers` endpoint returns the list of email addresses (from the `email` field) for the history of a source.  Only files should be specified in the path.  Example request:

`https://68exp8ppy6.execute-api.us-east-1.amazonaws.com/latest/maintainers/us/va/james_city.json`

This request would return (at the time of this documentation): 

```json
{
  "maintainers": [
    {
      "email": "propertyinfo@jamescitycountyva.gov"
    }
  ]
}
```

#### Error Conditions

`/maintainers` supports the following conditions:

- HTTP status 400 with a message is returned in the following scenarios:
  - the specified source does not exist
  - the contents of a commit are not JSON-parseable
- HTTP status 500 with a message is returned in the following scenarios:
  - GitHub authentication fails

### `/download`

The `/download` endpoint returns the URL for latest run of a source.  The [OpenAddresses results metadata file](https://results.openaddresses.io/state.txt) as a reference to find the requested source.  

#### Error Conditions

`/download` endpoint supports the following error conditions:

- HTTP status 400 with a message is returned in the following scenarios:
  - the specified source does not exist in the OpenAddresses result metadata file
- HTTP status 500 with a message is returned in the following scenarios:
  - the OpenAddresses results metadata file cannot be found
  - the processed data is not a .zip file

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
$ yarn test
```

## Production

The OpenAddresses Submit Service has been developed in such a way that it is stateless and can be run either locally or via AWS Lambdas using the API Gateway for request proxying.  [Claudia](https://claudiajs.com) is utilized for generating and deploying to AWS Lambdas + API Gateway.  The configuration is in place for this so to update the Lambda functions, perform the following:

1. ensure that devDependencies have been installed (using `yarn install`, which includes non-production dependencies)
2. ensure that `.aws/credentials` contains a `[claudia]` section with credentials for a deploy-capable user
3. enter the following at the command line: `yarn run deploy` (which runs the `claudia update` command)

The Submit Service API can be accessed on the `/sample`, `/upload`, and `/submit` endpoints using https://68exp8ppy6.execute-api.us-east-1.amazonaws.com/latest/.  

## Contributing

Please fork and pull request against upstream master on a feature branch.

Provide unit tests in the `test` directory.

## Continuous Integration

Travis tests every release against Node.js version `8`.

[![Build Status](https://travis-ci.org/openaddresses/submit-service.png?branch=master)](https://travis-ci.org/openaddresses/submit-service)
