  /*
   * @file everything to output database areas as json
   * @author jacob
   * @version 0.1
   */

const {Pool, Client} = require('pg');
const xml = require('xml');
const xml_parse_string = require('xml-js').xml2js;

const names = {
  en: {
    'areas_vw': 'Area',
    'points_of_interest': 'Points of interest',
    'access_roads': 'Access road',
    'avalanche_paths': 'Avalanche path',
    'decision_points': 'Decision point',
    'zones': 'Zone',
  },
  fr: {
    'areas_vw': 'Régions',
    'points_of_interest': "Points d'intérêt",
    'access_roads': "Routes d'accès",
    'avalanche_paths': 'Couloirs d’avalanche',
    'decision_points': 'point de décision',
    'zones': 'Zone',
  }
};

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
function Query(table, non_geometry_columns, where_clause, ogr_type, lang, bounding_box, subquery) {
  this.table = table;
  this.non_geometry_columns = non_geometry_columns;
  this.where_clause = where_clause;
  this.subquery = subquery;
  this.ogr_type = ogr_type;
  this.geometry_column = 'geom';
  this.bounding_box = typeof bounding_box !== 'undefined' ? bounding_box : false;
  this.lang = typeof lang !== 'undefined' ? lang : 'en';
  this.name = names[this.lang][table];
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

  /**
   * @function query_database
   * @description get rows from the database, mapped to features
   * @param  {Query} query_object - Array of Query objects
   * @param  {number}     area_id - area_id we're getting data from
   * @param  {Client}      client - pg {Client} object used to query the database
   * @return {Promise}              a {Feature} object for each row
   */
function geojson_query_database(query_object, area_id, client) {
  /**
   * @function row_to_feature
   * @description transform a feature into an object into a row
   * @return {Feature} 
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
    function object_to_feature(row, geometry_column) {
      geometry_column = typeof geometry_column !== 'undefined' ? geometry_column : 'geometry';
      geometry = row[geometry_column];
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

  /*
   * @return {Promise}          promises a geojson {FeatureCollection}
   * @param  {number} area_id
   * @param  {Client}  client - a pg postgresql client
   * @param  {Array}  queries - an array of {Query} objects
   */
function promise_of_geojson(area_id, client, queries) {
  const feature_collection = new Promise((resolve, reject) => {
    let features = [];

    const query_promises = queries.map((query) => geojson_query_database(query, area_id, client));
    Promise.all(query_promises).then(values => {
      values.forEach(querys_features => querys_features.forEach(
        feature => features.push(feature)
      ));
      const collected_features = new FeatureCollection(features);
      resolve(collected_features);
    });
  });

  return feature_collection;
}

function get_geojson(area_id) {
  const queries = [
    new Query(
      'areas_vw',
      ['id', 'name'],
      'id=$1',
      'GeoJSON',
      'en',
      bounding_box=true
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
      'en',
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
      'en',
      bounding_box=true
    )
  ];

  const client = new Client(); //from require('pg');
  client.connect();

  promise_of_geojson(area_id, client, queries)
    .then(r => {
      client.end();
      //TODO upload to mapbox
      console.log(JSON.stringify(r));
    });
}

function KML_query_database(query_object, area_id, client, new_placemark) {
  /**
   * @function row_to_feature
   * @description transform a feature into an object into a row
   * @return {Feature} 
   */
  function row_to_placemark(row, placemark_constructor) {
    function row_to_object(row) {
      row.table = query_object.table;
      if (row.table == 'decision_points') {
        warnings = get_warnings(query_object.subquery, row.id);
        row.warnings = warnings;
      }
      return row;
    }
    function object_to_feature(row, geometry_column) {
        //geometry_column = geometry_column || 'geometry';
        //geometry = row[geometry_column];
      /* TODO if things don't just work, decompose and recompose geometry here
        console.log(row.geometry);
        console.log(xml_parse_string(row.geometry), (err, res) => console.log(res));
        process.exit();
      */
      return placemark_constructor(row);
      /*
        feature_type = row['table'];
        delete row[geometry_row];
        delete row['table'];
        return new Feature(
          geometry,
          feature_type,
          row
        );
      */
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
        .then(res => res.rows.map(row => row_to_placemark(row, new_placemark)))
        .catch(e => console.error(e.stack))
    );
  });
}

function promise_KML(area_id, client, queries, new_placemark) {
  function new_document(name, folders) {
    let doc = folders.map(f => { return {'Folder': f }; } );
    //TODO styling stuff here
    return [ {
      'kml': [
        {'_attr': {
          'xmlns':    "http://www.opengis.net/kml/2.2",
          'xmlns:gx': "http://www.google.com/kml/ext/2.2" 
        } },
        {'Document': doc} 
      ] 
    } ];
  }
  function new_folder(name, features) {
    let folder = features.map(f => {
      return {'Placemark': f};
    });
    folder.push({name});
    //console.log(folder);
    //console.log(xml(folder));
    return folder;
  }
  /*
  const KML_document = new Promise((resolve, reject) => {
    let folders = [];

    query_promises = queries.map((query) => KML_query_database(query, area_id, client)); //ie, each should make a folder
    Promise.all(query_promises) //wait for each promise to resolve
      .then(values => {
        //values.forEach(querys_features => querys_features.forEach(
         // feature => folders.push(feature)
        //));
        console.log(folders);
        const KML_document = new_kml_document(folders);
        resolve(KML_document);
      });
  });
  */
  query = queries[0];
  const KML_document = new Promise((resolve, reject) => {
    let folders = [];
    let doc_name = '';

    const query_promises = queries.map(query => KML_query_database(query, area_id, client, new_placemark));
    Promise.all(query_promises).then(values => {
      values.forEach(querys_rows => {
        //console.log(querys_rows[0][1].name);
        //process.exit();
        folders.push(new_folder(query.name, querys_rows));
      })
      const KML_doc = new_document('NAME OF AREA TODO', folders);
      resolve(KML_doc);
    }).catch(e => console.error(e.stack));
  });
  return KML_document;
}

function get_KML(area_id, lang) {
  lang = lang || 'en';

  const style_urls = {
    'zones': [
      'filler for slot 0',
      'zone_green_style',
      'zone_blue_style',
      'zone_black_style',
    ],
    //'areas_vw': 
    'access_roads': 'access_road_styles',
    'avalanche_paths': 'avalanche_path_styles',
    'decision_points': 'decision_point_styles',
    'points_of_interest': 'point_of_interest_styles'
  };

  const style = (url, styles, style_type) => { //what styleUrls point to
    style_type = style_type || 'Style';
    return {
      [style_type]: [
        {'_attr': {'id': url}},
        ...styles,
      ]
    }
  }

  const styles = {
    'zone_green_style': style('zone_green_style', [
      {color: '#55ff0088'} //green
    ]),
    'zone_blue_style': style('zone_blue_style', [
      {color: '#0000ff88'} //blue
    ]),
    'zone_black_style': style('zone_black_style', [
      {color: '#00000088'} //black
    ]),
    'access_roads': style(style_urls.access_roads, [
      {color: '#ffff00'}, //yellow
      {'gx:outerColor': '#00ff00'} //green
    ], 'LineStyle'),
    'avalanche_paths': style(style_urls.avalanche_paths, [
      {color: '#ff0000'}
    ], 'LineStyle'),
    'decision_points': style(style_urls.decision_points, [
      {color: '#ff005d'}
    ]),
    'points_of_interest': style(style_urls.points_of_interest, [
      {color: '#ff0000'}
    ]),
  };

  const new_placemark = (row, style_urls) => {
    function extend_data(placemark, data) {
      placemark.push({'ExtendedData': data});
    }
    function describe(placemark, description) {
      //TODO don't let things overlap
      placemark.push({'description': description});
    }

    const table = row.table;
    const geometry = row.geometry;
    const name = row.name;
    const comments = row.comments;
    const class_code = row.class_code;
    const type = row.type;
    const description = row.description;
    const warnings = row.warnings;
    const styleUrl = (class_code) ? style_urls[table][class_code] : style_urls[table] ;

    let placemark = [];
    placemark.push({'Geometry': geometry});
    //placemark.push(geometry); //you'll probably have to parse the xml? //TODO change to this
    if (name) {
      placemark.push({'name': name});
    }
    if (comments) {
      describe(placemark, comments);
    }
    if (description) {
      describe(placemark, description);
    }
    if (type) {
      describe(placemark, type);
    }
    if (warnings) {
      extend_data(placemark, warnings);
    }
    if (class_code) {
      extend_data(placemark, class_code);
    }
    if (styleUrl) {
      placemark.push({styleUrl});
    }
    return placemark;
  };

  const newer_placemark = (row) => new_placemark(row, style_urls);

  /*
  const row = {geometry: 'g', class_code: 3, comments: null, table: 'zones'};
  const scary_zone = newer_placemark(row);
  console.log(scary_zone);
  process.exit();

  const constructor_object = {
    'zones': (row) => new_placemark(row.geometry, null, row.comments, row.class_code),
    'areas_vw': (row) => new_placemark(row.geometry, row.name),
    'access_roads': (row) => new_placemark(row.geometry, null, null, null, null, row.description),
    'avalanche_paths': (row) => new_placemark(row.geometry, row.name),
    'decision_points': (row) => new_placemark(row.geometry, row.name, row.comments, null, null, null, row.warnings),
    'points_of_interest': (row) => new_placemark(row.geometry, row.name, row.comments, row.type)
  };

    function gen_test_placemarks() {
      let placemarks = [];
      placemarks.push(new_zone('g', 'comment', 1));
      placemarks.push(new_area('g', 'area'));
      placemarks.push(new_avalanche_path('g', 'av_path'));
      placemarks.push(new_decision_point(
        'g', 'scary place', 'scary', ['scary', 'real scary']
      ));
      placemarks.push(new_point_of_interest(
        'g', 'cool place', 'cool', 'comment'
      ));
      placemarks.push(new_access_road('g', 'road'));

      //console.log(placemarks);
      //placemarks.forEach(placemark => console.log(xml(placemark)));
      return placemarks;
    };

    const folder = new_folder('zones', gen_test_placemarks());
  */

  const queries = [
    new Query(
      'areas_vw',
      ['name'],
      'id=$1',
      'KML',
      lang
    ),
    new Query(
      'points_of_interest',
      ['name', 'type', 'comments'], //TODO lowercase and dasherize type
      'area_id=$1',
      'KML',
      lang
    ),
    new Query(
      'access_roads',
      ['description'],
      'area_id=$1',
      'KML',
      lang
    ),
    new Query(
      'avalanche_paths',
      ['name'],
      'area_id=$1',
      'KML',
      lang
    ),
    new Query(
      'decision_points',
      ['name', 'comments'],
      'area_id=$1',
      'KML',
      lang,
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
      ['class_code', 'comments'],
      'area_id=$1',
      'KML',
      lang
    )
  ];

  const client = new Client(); //from require('pg');
  client.connect();

  promise_KML(area_id, client, queries, newer_placemark)
    .then(r => {
      client.end();
      console.log(xml(r));
    });

  /*
  promise_KML(area_id, client, queries)
    .then(r => {
      client.end();
      console.log(r);
    });
  */
}

get_KML(357, 'fr');
