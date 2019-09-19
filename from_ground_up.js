/*
 * @file everything to output database areas as json
 * @author jacob
 * @version 0.1
 */

const {Pool, Client} = require('pg');
const tokml = require('tokml');

  /**
   * @param {JSON} geometry - GeoJSON geometry object
   * @param {string} feature_type  - the table the feature came from
   * @param {object} properties    - properties associated with feature. Every column pulled from the table that isn't geometry.
   */
function Feature (geometry, feature_type, properties) {
  this.type = "Feature";
  this.geometry = JSON.parse(geometry);
  this.properties = properties;
  this.properties.type = feature_type;
}

  /**
   * @param {Array} features - list of the features collected
   */
function FeatureCollection(features)  {
  this.type = "FeatureCollection";
  this.features = features;
}

  /**
   * @param {string} table                - table to SELECT from
   * @param {Array}  non_geometry_columns - columns that don't contain geometry
   * @param {string} where_clause         - SQL WHERE clause, eg "WHERE area_id=$1"
   * @param {string} geometry_column      - column with the geometry
   * @param {Query}  subquery             - in practice, query to decision_point_warnings from inside decision_points
   */
function Query(table, non_geometry_columns, where_clause, ogr_type, bounding_box, subquery, name) {
  this.table = table;
  this.non_geometry_columns = non_geometry_columns;
  this.where_clause = where_clause;
  this.subquery = subquery;
  this.ogr_type = ogr_type;
  this.geometry_column = 'geom';
  this.bounding_box = typeof bounding_box !== 'undefined' ? bounding_box : false;
  this.name = typeof name !== 'undefined' ? name : this.table;
  this.geometry_transformation;

  switch(ogr_type) {
    case 'KML':
      this.geometry_transformation = 'ST_AsKML'; //TODO check this
      break;
    case 'GeoJSON':
    default:
      this.geometry_transformation = 'ST_AsGeoJSON';
      break;
  }

  //TODO redo this section
  this.to_query = function() {
    if (this.geometry_column == null) {
      return `SELECT ${this.non_geometry_columns.join(', ')} FROM ${this.table} WHERE ${this.where_clause};`;
    } else {
      if (bounding_box) {
        return `SELECT ${this.geometry_transformation}(${this.geometry_column}) AS geometry, ${this.geometry_transformation}(ST_Envelope(${this.geometry_column})) AS bounding_box, ${this.non_geometry_columns.join(', ')} FROM ${this.table} WHERE ${this.where_clause};`;
      } else {
        return `SELECT ${this.geometry_transformation}(${this.geometry_column}) AS geometry, ${this.non_geometry_columns.join(', ')} FROM ${this.table} WHERE ${this.where_clause};`;
      }
    }
  };
}

function query_database(query_object, area_id, client) {
  /**
   * @function get_from_database
   * @description get rows from the database
   * @param {Array} queries - Array of Query objects
   * @param {int} area_id   - area_id we're getting data from
   * @param {Client} client - pg Client object used to query the database
   * @yield {row}             database row
   */
  function row_to_feature(row) {
    function row_to_object(row) {
      row.table = query_object.table;
      if (row.table == 'decision_points') {
        warnings = get_warnings(query_object.subquery, row.id);
        row.warnings = warnings;
      }
      return row;
    }
    function object_to_feature(row, geometry_row='geometry') {
      geometry = row[geometry_row];
      feature_type = row['table'];
      delete row[geometry_row];
      delete row['table'];
      return new Feature(
        geometry,
        feature_type,
        row
      );
    }
    return object_to_feature(row_to_object(row))
  }

  const query = {
    name: `get rows from ${query_object.table}`,
    text: query_object.to_query(),
    values: [area_id],
  };

  return new Promise((resolve, reject) => {
    resolve(
      client.query(query)
        .then(res => res.rows.map(row_to_feature))
        .catch(e => console.error(e.stack))
    );
  });
}

function promise_of_geojson(area_id, client, queries) {
  const feature_collection = new Promise((resolve, reject) => {
    let features = [];

    query_promises = queries.map((query) => query_database(query, area_id, client));
    Promise.all(query_promises).then(values => {
      values.forEach(table_of_features => table_of_features.forEach(
        feature => features.push(feature)
      ));
      const collected_features = new FeatureCollection(features);
      resolve(collected_features);
    });
  });

  //const geojson = JSON.stringify(feature_collection);

  return feature_collection;
}

function get_geojson(area_id) {
  const client = new Client(); //from require('pg');

  const queries = [
    new Query(
      'areas_vw',
      ['id', 'name'],
      'id=$1',
      'GeoJSON',
      geometry_row='geom',
      bounding_box=true,
      subquery=undefined,
      name='area'
    ),
    new Query(
      'points_of_interest',
      ['id', 'area_id', 'name', 'type', 'comments'], //TODO lowercase and dasherize type
      'area_id=$1',
      'GeoJSON'
    ),
    new Query(
      'access_roads',
      ['id', 'area_id', 'description'],
      'area_id=$1',
      'GeoJSON'
    ),
    new Query(
      'avalanche_paths',
      ['id', 'area_id', 'name'],
      'area_id=$1',
      'GeoJSON'
    ),
    new Query(
      'decision_points',
      ['id', 'name', 'area_id', 'comments'],
      'area_id=$1',
      'GeoJSON',
      bounding_box=false,
      subquery=new Query(
        'decision_points_warnings',
        ['warning', 'type'],
        'decision_point_id=$1',
        geometry_row=null
      )
    ),
    new Query(
      'zones',
      ['id', 'area_id', 'class_code', 'comments'],
      'area_id=$1',
      'GeoJSON',
      bounding_box=true
    )
  ];

  client.connect();

  promise_of_geojson(area_id, client, queries)
    .then(r => {
      client.end();
      //TODO upload to mapbox
      console.log(JSON.stringify(r));
    });
}

get_geojson(357);
