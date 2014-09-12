var test = require('tap').test,
    fs = require('fs'),
    queue = require('queue-async'),
    concat = require('concat-stream'),
    _ = require('lodash'),
    bufferEqual = require('buffer-equal'),
    Cardboard = require('../'),
    Metadata = require('../lib/metadata'),
    geojsonExtent = require('geojson-extent'),
    geojsonFixtures = require('geojson-fixtures'),
    geojsonNormalize = require('geojson-normalize'),
    fixtures = require('./fixtures'),
    fakeAWS = require('mock-aws-s3');

var config = {
    awsKey: 'fake',
    awsSecret: 'fake',
    table: 'geo',
    endpoint: 'http://localhost:4567',
    bucket: 'test',
    prefix: 'test',
    s3: fakeAWS.S3() // only for mocking s3
};

var emptyFeatureCollection = {
    type: 'FeatureCollection',
    features: []
};

var dynalite, client, db;

var dyno = require('dyno')(config);

function setup() {
    test('setup', function(t) {
        dynalite = require('dynalite')({
            createTableMs: 0,
            updateTableMs: 0,
            deleteTableMs: 0
        });
        dynalite.listen(4567, function() {
            t.pass('dynalite listening');
            var cardboard = Cardboard(config);
            cardboard.createTable(config.table, function(err, resp){
                t.pass('table created');
                t.end();
            });
        });
    });
}

function teardown() {
    test('teardown', function(t) {
        dynalite.close(function() {
            t.end();
        });
    });
}

setup();
test('tables', function(t) {
    dyno.listTables(function(err, res) {
        t.equal(err, null);
        t.deepEqual(res, { TableNames: ['geo'] });
        t.end();
    });
});
teardown();

setup();
test('dump', function(t) {
    var cardboard = Cardboard(config);
    cardboard.dump(function(err, data) {
        t.equal(err, null);
        t.deepEqual(data.items, [], 'no results with a new database');
        t.end();
    });
});
teardown();

setup();
test('no new', function(t) {
    var cardboard = Cardboard(config);

    cardboard.dumpGeoJSON(function(err, data) {
        t.deepEqual(data, emptyFeatureCollection, 'no results with a new database');
        t.equal(err, null);
        t.end();
    });
});
teardown();

setup();
test('dumpGeoJSON', function(t) {
    var cardboard = Cardboard(config);

    cardboard.dumpGeoJSON(function(err, data) {
        t.deepEqual(data, emptyFeatureCollection, 'no results with a new database');
        t.equal(err, null);
        t.end();
    });
});
teardown();

setup();
test('insert, index & dump', function(t) {
    var cardboard = Cardboard(config);
    var dataset = 'default';

    cardboard.put(fixtures.nullIsland, dataset, function(err, res) {
        t.equal(err, null);
        t.pass('inserted');
        var primary = res.id, timestamp = res.timestamp;
        cardboard.addFeatureIndexes(primary, dataset, timestamp, function(err) {
            t.ifError(err, 'indexed feature');
            cardboard.dump(function(err, data) {
                t.equal(err, null);
                t.equal(data.items.length, 3, 'creates data, index and metadata');
                t.end();
            });
        });
    });
});
teardown();

setup();
test('insert, index & get by index', function(t) {
    var cardboard = Cardboard(config);

    cardboard.put(fixtures.nullIsland, 'default', function(err, res) {
        t.ifError(err, 'inserted');
        var primary = res.id, timestamp = res.timestamp;
        cardboard.addFeatureIndexes(primary, 'default', timestamp, function(err) {
            t.ifError(err, 'indexed feature');
            cardboard.get(primary, 'default', function(err, data) {
                t.equal(err, null);
                fixtures.nullIsland.id = primary;
                t.deepEqual(data, geojsonNormalize(fixtures.nullIsland));
                delete fixtures.nullIsland.id;
                t.end();
            });
        });
    });
});
teardown();

setup();
test('insert & update', function(t) {
    var cardboard = Cardboard(config);

    cardboard.put(fixtures.haitiLine, 'default', function(err, res) {
        t.equal(err, null);
        var primary = res.id, timestamp = res.timestamp;

        t.ok(primary, 'got id');
        t.pass('inserted');
        fixtures.haitiLine.id = primary;
        fixtures.haitiLine.geometry.coordinates[0][0] = -72.588671875;

        cardboard.addFeatureIndexes(primary, 'default', timestamp, function(err) {
            t.ifError(err, 'indexed');
            dyno.query({
                id: { 'BEGINS_WITH': [ 'cell!' ] },
                dataset: { 'EQ': 'default' }
            },
            { pages: 0 },
            function(err, data){
                t.equal(data.items.length, 50, 'correct num of index entries');
                updateFeature();
            });
        });

        function updateFeature(){
            cardboard.put(fixtures.haitiLine, 'default', timestamp, function(err, res) {
                t.equal(err, null);
                var id = res.id, timestamp = res.timestamp;
                t.equal(id, primary);
                delete fixtures.haitiLine.id;
                cardboard.addFeatureIndexes(primary, 'default', timestamp, function(err) {
                    dyno.query({
                        id: { 'BEGINS_WITH': [ 'cell!' ] },
                        dataset: { 'EQ': 'default' }
                    },
                    { pages: 0 },
                    function(err, data){

                        t.equal(data.items.length, 50, 'correct num of index entries');
                        t.end();
                    });
                });
            });
        }
    });
});
teardown();

setup();
test('insert & delete', function(t) {
    var cardboard = Cardboard(config);

    cardboard.put(fixtures.nullIsland, 'default', function(err, res) {
        t.equal(err, null);
        t.pass('inserted');
        var primary = res.id, timestamp = res.timestamp;
        cardboard.get(primary, 'default', function(err, data) {
            t.equal(err, null);
            fixtures.nullIsland.id = primary;
            t.deepEqual(data, geojsonNormalize(fixtures.nullIsland));
            delete fixtures.nullIsland.id;
            cardboard.remove(primary, 'default', function(err, data) {
                t.ifError(err, 'removed')
                cardboard.get(primary, 'default', function(err, data) {
                    t.equal(err, null);
                    t.deepEqual(data, emptyFeatureCollection);
                    t.end();
                });
            });
        });
    });
});
teardown();


setup();
test('insert & delDataset', function(t) {
    var cardboard = Cardboard(config);

    cardboard.put(fixtures.nullIsland, 'default', function(err, res) {
        t.equal(err, null);
        t.pass('inserted');
        var primary = res.id, timestamp = res.timestamp;
        cardboard.get(primary, 'default', function(err, data) {
            t.equal(err, null);
            fixtures.nullIsland.id = primary;
            t.deepEqual(data, geojsonNormalize(fixtures.nullIsland));
            delete fixtures.nullIsland.id;
            cardboard.delDataset('default', function(err, data) {
                t.equal(err, null);
                cardboard.get(primary, 'default', function(err, data) {
                    t.equal(err, null);
                    t.deepEqual(data.features.length, 0);
                    t.end();
                });
            });
        });
    });
});
teardown();



setup();
test('listIds', function(t) {
    var cardboard = Cardboard(config);

    cardboard.put(fixtures.nullIsland, 'default', function(err, res) {
        t.equal(err, null);
        t.pass('inserted');
        var primary = res.id, timestamp = res.timestamp;
        cardboard.addFeatureIndexes(primary, 'default', timestamp, function(err, data) {
            t.ifError(err, 'indexed');
            cardboard.listIds('default', function(err, data) {
                var expected = [
                    'cell!1!10000000001!' + primary,
                    'id!' + primary,
                    'metadata!default'
                ];
                t.deepEqual(data, expected);
                t.end();
            });
        });
    });
});
teardown();

setup();
test('insert & query', function(t) {
    var queries = [
        {
            query: [-10, -10, 10, 10],
            length: 1
        },
        {
            query: [30, 30, 40, 40],
            length: 0
        },
        {
            query: [10, 10, 20, 20],
            length: 0
        },
        {
            query: [-76.0, 38.0, -79, 40],
            length: 1
        }
    ];
    var cardboard = Cardboard(config);
    var insertQueue = queue(1);
    var indexQueue = queue(1);

    [fixtures.nullIsland,
    fixtures.dc].forEach(function(fix) {
        insertQueue.defer(cardboard.put, fix, 'default');
    });

    insertQueue.awaitAll(function(err, res) {
        t.ifError(err, 'inserted');
        res.forEach(function(item) {
            indexQueue.defer(cardboard.addFeatureIndexes, item.id, 'default', item.timestamp);
        });
        indexQueue.awaitAll(inserted);
    });

    function inserted() {
        var q = queue(1);
        queries.forEach(function(query) {
            q.defer(function(query, callback) {
                t.equal(cardboard.bboxQuery(query.query, 'default', function(err, resp) {
                    t.ifError(err, 'no error for ' + query.query.join(','));
                    if (err) return callback(err);

                    t.equal(resp.features.length, query.length, 'finds ' + query.length + ' data with a query');
                    callback();
                }), undefined, '.bboxQuery');
            }, query);
        });
        q.awaitAll(function(err) {
            t.ifError(err, 'queries passed');
            t.end();
        });
    }
});
teardown();

setup();
test('insert polygon', function(t) {
    var cardboard = Cardboard(config);
    cardboard.put(fixtures.haiti, 'default', inserted);

    function inserted(err, res) {
        t.notOk(err, 'no error returned');
        var queries = [
            {
                query: [-10, -10, 10, 10],
                length: 0
            },
            {
                query: [-76.0, 38.0, -79, 40],
                length: 0
            }
        ];
        var q = queue(1);
        queries.forEach(function(query) {
            q.defer(function(query, callback) {
                t.equal(cardboard.bboxQuery(query.query, 'default', function(err, resp) {
                    t.equal(err, null, 'no error for ' + query.query.join(','));
                    t.equal(resp.features.length, query.length, 'finds ' + query.length + ' data with a query');
                    callback();
                }), undefined, '.bboxQuery');
            }, query);
        });
        q.awaitAll(function() { t.end(); });
    }
});
teardown();

setup();
test('insert linestring', function(t) {
    var cardboard = Cardboard(config);
    cardboard.put(fixtures.haitiLine, 'default', inserted);

    function inserted(err, res) {
        t.notOk(err, 'no error returned');
        var queries = [
            {
                query: [-10, -10, 10, 10],
                length: 0
            },
            {
                query: [-76.0, 38.0, -79, 40],
                length: 0
            }
        ];
        var q = queue(1);
        queries.forEach(function(query) {
            q.defer(function(query, callback) {
                t.equal(cardboard.bboxQuery(query.query, 'default', function(err, resp) {
                    t.equal(err, null, 'no error for ' + query.query.join(','));
                    t.equal(resp.features.length, query.length, 'finds ' + query.length + ' data with a query');
                    callback();
                }), undefined, '.bboxQuery');
            }, query);
        });
        q.awaitAll(function() { t.end(); });
    }
});
teardown();

setup();
test('insert idaho', function(t) {
    var cardboard = Cardboard(config);
    t.pass('inserting idaho');
    
    var idaho = geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0];
    cardboard.put(idaho, 'default', function(err, res) {
        t.ifError(err, 'inserted');
        if (err) return t.end();
        cardboard.addFeatureIndexes(res.id, 'default', res.timestamp, inserted);
    });

    function inserted(err) {
        t.ifError(err, 'indexed');
        if (err) return t.end();

        var bbox = [-115.09552001953124,45.719603972998634,-114.77691650390625,45.947330315089275];
        cardboard.bboxQuery(bbox, 'default', function(err, res) {
            t.ifError(err, 'no error for ' + bbox.join(','));
            t.equal(res.features.length, 1, 'finds 1 data with a query');
            t.end();
        });
    }
});
teardown();


setup();
test('insert datasets and listDatasets', function(t) {
    var cardboard = Cardboard(config);
    var q = queue(1);
    q.defer(function(cb) {
        cardboard.put(fixtures.haiti, 'haiti', function(){
            cb();
        });
    });
    q.defer(function(cb) {
        cardboard.put(fixtures.dc, 'dc', function(){
            cb()
        });
    });

    q.awaitAll(getDatasets)

    function getDatasets(){
        cardboard.listDatasets(function(err, res){
            t.notOk(err, 'should not return an error')
            t.ok(res, 'should return a array of datasets');
            t.equal(res.length, 2)
            t.equal(res[0], 'dc')
            t.equal(res[1], 'haiti')
            t.end();
        })
    }
});
teardown();

setup();
test('insert feature with user specified id.', function(t) {
    var cardboard = Cardboard(config);
    var q = queue(1);

    q.defer(cardboard.put, fixtures.haiti, 'haiti');
    q.defer(cardboard.put, fixtures.haiti, 'haiti');
    q.defer(cardboard.put, fixtures.haitiLine, 'haiti');

    q.awaitAll(function(err, res) {
        var indexQueue = queue();
        res.forEach(function(item) {
            indexQueue.defer(cardboard.addFeatureIndexes, item.id, 'haiti', item.timestamp);
        });
        indexQueue.awaitAll(function(err) {
            t.ifError(err, 'indexed');
            if (err) return t.end();

            getByUserSpecifiedId(res.map(function(item) { return item.id; }));
        })
    });

    function getByUserSpecifiedId(ids){
        cardboard.getBySecondaryId(fixtures.haiti.properties.id, 'haiti', function(err, res){
            t.notOk(err, 'should not return an error');
            t.ok(res, 'should return a array of features');
            t.equal(res.features.length, 2);
            t.equal(res.features[0].properties.id, 'haitipolygonid');
            t.equal(res.features[0].id, ids[0]);
            t.equal(res.features[1].properties.id, 'haitipolygonid');
            t.equal(res.features[1].id, ids[1]);
            t.end();
        });
    }
});
teardown();

setup();
test('update feature that doesnt exist.', function(t) {
    var cardboard = Cardboard(config);
    var q = queue(1);

    fixtures.haiti.id = 'doesntexist';

    cardboard.put(fixtures.haiti, 'default', 12, failUpdate);

    function failUpdate(err, ids) {
        t.ok(err, 'should return an error');
        t.notOk(ids, 'should return an empty of ids');
        t.equal(err.code, 'ConditionalCheckFailedException');
        t.end();
    }
});
teardown();

// Metadata tests
var dataset = 'metadatatest';
var metadata = Metadata(dyno, dataset);
var initial = {
        id: metadata.recordId,
        dataset: dataset,
        count: 12,
        size: 1024,
        west: -10,
        south: -10,
        east: 10,
        north: 10
    };

setup();
test('metadata: get', function(t) {

    metadata.getInfo(noMetadataYet);

    function noMetadataYet(err, info) {
        t.ifError(err, 'get non-extistent metadata');
        t.deepEqual({}, info, 'returned blank obj when no info exists');
        dyno.putItem(initial, withMetadata);
    }

    function withMetadata(err, res) {
        t.ifError(err, 'put test metadata');
        metadata.getInfo(function(err, info) {
            t.ifError(err, 'get metadata');
            t.deepEqual(info, initial, 'valid metadata');
            t.end();
        })
    }
});
teardown();

setup();
test('metadata: defaultInfo', function(t) {

    metadata.defaultInfo(function(err, res) {
        t.ifError(err, 'no error when creating record');
        t.ok(res, 'response indicates record was created');
        dyno.putItem(initial, overwrite);
    });

    function overwrite(err, res) {
        t.ifError(err, 'overwrote default record');
        metadata.defaultInfo(applyDefaults);
    }

    function applyDefaults(err, res) {
        t.ifError(err, 'no error when defaultInfo would overwrite');
        t.notOk(res, 'response indicates no adjustments were made');
        metadata.getInfo(checkRecord);
    }

    function checkRecord(err, info) {
        t.ifError(err, 'got metadata');
        t.deepEqual(info, initial, 'existing metadata not adjusted by defaultInfo');
        t.end();
    }
});
teardown();

setup();
test('metadata: adjust size or count', function(t) {

    metadata.adjustProperties({ count: 10 }, function(err, res) {
        t.ifError(err, 'graceful if no metadata exists');
        metadata.getInfo(checkEmpty);
    });

    function checkRecord(attr, expected, callback) {
        metadata.getInfo(function(err, info) {
            t.ifError(err, 'get metadata');
            t.equal(info[attr], expected, 'expected value');
            callback();
        });
    }

    function checkEmpty(err, info) {
        t.ifError(err, 'gets empty record');
        t.deepEqual(info, {}, 'no record created by adjustProperties routine');
        dyno.putItem(initial, addCount);
    }

    function addCount(err, res) {
        t.ifError(err, 'put metadata record');
        metadata.adjustProperties({ count: 1 }, function(err, res) {
            t.ifError(err, 'incremented count by 1');
            checkRecord('count', initial.count + 1, subtractCount);
        });
    }

    function subtractCount() {
        metadata.adjustProperties({ count: -1 }, function(err, res) {
            t.ifError(err, 'decrement count by 1');
            checkRecord('count', initial.count, addSize);
        });
    }

    function addSize() {
        metadata.adjustProperties({ size: 1024 }, function(err, res) {
            t.ifError(err, 'incremented size by 1024');
            checkRecord('size', initial.size + 1024, subtractSize);
        });
    }

    function subtractSize() {
        metadata.adjustProperties({ size: -1024 }, function(err, res) {
            t.ifError(err, 'decrement size by 1024');
            checkRecord('size', initial.size, addBoth);
        });
    }

    function addBoth() {
        metadata.adjustProperties({ count: 1, size: 1024 }, function(err, res) {
            t.ifError(err, 'increment size and count');
            checkRecord('size', initial.size + 1024, function() {
                checkRecord('count', initial.count + 1, function() {
                    t.end();
                });
            });
        });
    }

});
teardown();

setup();
test('metadata: adjust bounds', function(t) {
    var bbox = [-12.01, -9, 9, 12.01];

    metadata.adjustBounds(bbox, function(err) {
        t.ifError(err, 'graceful if no metadata exists');
        metadata.getInfo(checkEmpty);
    });

    function checkEmpty(err, info) {
        t.ifError(err, 'gets empty record');
        t.deepEqual(info, {}, 'no record created by adjustBounds routine');
        dyno.putItem(initial, adjust);
    }

    function adjust(err, res) {
        t.ifError(err, 'put metadata record');
        metadata.adjustBounds(bbox, adjusted);
    }

    function adjusted(err, res) {
        t.ifError(err, 'adjusted bounds without error');
        metadata.getInfo(checkNewInfo);
    }

    function checkNewInfo(err, info) {
        t.ifError(err, 'get new metadata');
        var expected = {
            id: 'metadata!' + dataset, 
            dataset: dataset,
            west: initial.west < bbox[0] ? initial.west : bbox[0],
            south: initial.south < bbox[1] ? initial.south : bbox[1],
            east: initial.east > bbox[2] ? initial.east : bbox[2],
            north: initial.north > bbox[3] ? initial.north : bbox[3],
            count: initial.count,
            size: initial.size
        };
        t.deepEqual(info, expected, 'updated metadata correctly');
        t.end();
    }
});
teardown();

setup();
test('metadata: add a feature', function(t) {
    var feature = geojsonFixtures.feature.one;
    var expectedSize = JSON.stringify(feature).length;
    var expectedBounds = geojsonExtent(feature);

    metadata.addFeature(feature, brandNew);

    function brandNew(err) {
        t.ifError(err, 'used feature to make new metadata');
        metadata.getInfo(function(err, info) {
            t.ifError(err, 'got metadata');
            t.equal(info.count, 1, 'correct feature count');
            t.equal(info.size, expectedSize, 'correct size');
            t.equal(info.west, expectedBounds[0], 'correct west');
            t.equal(info.south, expectedBounds[1], 'correct south');
            t.equal(info.east, expectedBounds[2], 'correct east');
            t.equal(info.north, expectedBounds[3], 'correct north');

            dyno.putItem(initial, replacedMetadata);
        });
    }

    function replacedMetadata(err) {
        t.ifError(err, 'replaced metadata');
        metadata.addFeature(feature, adjusted);
    }

    function adjusted(err) {
        t.ifError(err, 'adjusted existing metadata');
        metadata.getInfo(function(err, info) {
            t.ifError(err, 'got metadata');
            t.equal(info.count, initial.count + 1, 'correct feature count');
            t.equal(info.size, initial.size + expectedSize, 'correct size');

            var expectedWest = expectedBounds[0] < initial.west ? 
                    expectedBounds[0] : initial.west,
                expectedSouth = expectedBounds[1] < initial.south ? 
                    expectedBounds[1] : initial.south,
                expectedEast = expectedBounds[2] > initial.east ? 
                    expectedBounds[2] : initial.east,
                expectedNorth = expectedBounds[3] > initial.north ? 
                    expectedBounds[3] : initial.north;

            t.equal(info.west, expectedWest, 'correct west');
            t.equal(info.south, expectedSouth, 'correct south');
            t.equal(info.east, expectedEast, 'correct east');
            t.equal(info.north, expectedNorth, 'correct north');

            t.end();
        });
    }
});
teardown();

setup();
test('metadata: update a feature', function(t) {
    var original = geojsonFixtures.feature.one;
    var edited = geojsonFixtures.featurecollection.idaho.features[0];
    var expectedSize = JSON.stringify(edited).length - JSON.stringify(original).length;
    var expectedBounds = geojsonExtent(edited);

    metadata.updateFeature(original, edited, function(err) {
        t.ifError(err, 'graceful exit if no metadata exists');
        metadata.getInfo(checkEmpty);
    });

    function checkEmpty(err, info) {
        t.ifError(err, 'gets empty record');
        t.deepEqual(info, {}, 'no record created by updateFeature routine');
        metadata.defaultInfo(andThen);
    }

    function andThen(err) {
        t.ifError(err, 'default metadata');
        metadata.updateFeature(original, edited, checkInfo);
    }

    function checkInfo(err) {
        t.ifError(err, 'updated metadata');
        metadata.getInfo(function(err, info) {
            t.ifError(err, 'got metadata');
            t.equal(info.count, 0, 'correct feature count');
            t.equal(info.size, expectedSize, 'correct size');
            t.equal(info.west, expectedBounds[0], 'correct west');
            t.equal(info.south, expectedBounds[1], 'correct south');
            t.equal(info.east, expectedBounds[2], 'correct east');
            t.equal(info.north, expectedBounds[3], 'correct north');
            t.end();
        });
    }

});
teardown();

setup();
test('metadata: remove a feature', function(t) {
    var feature = geojsonFixtures.feature.one;
    var expectedSize = JSON.stringify(feature).length;

    metadata.deleteFeature(feature, function(err) {
        t.ifError(err, 'graceful exit if no metadata exists');
        metadata.getInfo(checkEmpty);
    });

    function checkEmpty(err, info) {
        t.ifError(err, 'gets empty record');
        t.deepEqual(info, {}, 'no record created by adjustBounds routine');
        dyno.putItem(initial, del);
    }

    function del(err) {
        t.ifError(err, 'put default metadata');
        metadata.deleteFeature(feature, checkInfo);
    }

    function checkInfo(err) {
        t.ifError(err, 'updated metadata');
        metadata.getInfo(function(err, info) {
            t.ifError(err, 'got info');
            t.equal(info.count, initial.count - 1, 'correct feature count');
            t.equal(info.size, initial.size - expectedSize, 'correct size');
            t.equal(info.west, initial.west, 'correct west');
            t.equal(info.south, initial.south, 'correct south');
            t.equal(info.east, initial.east, 'correct east');
            t.equal(info.north, initial.north, 'correct north');
            t.end();
        });
    }
});
teardown();

setup();
test('insert idaho & check metadata', function(t) {
    var cardboard = new Cardboard(config);
    var q = queue();
    t.pass('inserting idaho');
    geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    }).forEach(function(block) {
        q.defer(cardboard.put, block, dataset);
    });
    q.awaitAll(inserted);

    function inserted(err, res) {
        if (err) console.error(err);
        t.notOk(err, 'no error returned');
        t.pass('inserted idaho');
        metadata.getInfo(checkInfo);
    }

    function checkInfo(err, info) {
        t.ifError(err, 'got idaho metadata');
        var expected = {
            id : "metadata!" + dataset,
            dataset : dataset,
            west : -116.108998,
            south : 45.196187,
            east : -114.320252,
            north : 46.671061,
            count : 0,
            size : 0
        }
        t.deepEqual(info, expected, 'expected metadata');
        t.end();
    }
});
teardown();

setup();
test('insert many idaho features & check metadata', function(t) {
    var cardboard = new Cardboard(config);
    var features = geojsonFixtures.featurecollection.idaho.features.slice(0, 50);
    var expectedBounds = geojsonExtent({ type: 'FeatureCollection', features: features });
    var expectedSize = features.reduce(function(memo, feature) {
        memo = memo + JSON.stringify(feature).length;
        return memo;
    }, 0);

    var q = queue();
    features.forEach(function(block) {
        q.defer(cardboard.put, block, dataset);
    });
    q.awaitAll(inserted);

    function inserted(err, res) {
        if (err) console.error(err);
        t.notOk(err, 'no error returned');
        t.pass('inserted idaho features');
        metadata.getInfo(checkInfo);
    }

    function checkInfo(err, info) {
        t.ifError(err, 'got idaho metadata');
        var expected = {
          id : "metadata!" + dataset,
          dataset : dataset,
          west : expectedBounds[0],
          south : expectedBounds[1],
          east : expectedBounds[2],
          north : expectedBounds[3],
          count : 0,
          size : 0
        }
        t.deepEqual(info, expected, 'expected metadata');
        t.end();
    }
});
teardown();

setup();
test('insert many idaho features, delete one & check metadata', function(t) {
    var cardboard = new Cardboard(config);
    var features = geojsonFixtures.featurecollection.idaho.features.slice(0, 50);
    var deleteThis = features[9];
    var expectedBounds = geojsonExtent({ type: 'FeatureCollection', features: features });
    var expectedSize = features.reduce(function(memo, feature) {
        memo = memo + JSON.stringify(feature).length;
        return memo;
    }, 0) - JSON.stringify(deleteThis).length;

    var q = queue();
    features.forEach(function(block) {
        q.defer(cardboard.put, block, dataset);
    });
    q.defer(metadata.deleteFeature, deleteThis);
    q.awaitAll(inserted);

    function inserted(err, res) {
        if (err) console.error(err);
        t.notOk(err, 'no error returned');
        t.pass('inserted idaho features and deleted one');
        metadata.getInfo(checkInfo);
    }

    function checkInfo(err, info) {
        t.ifError(err, 'got idaho metadata');
        var expected = {
          id : "metadata!" + dataset,
          dataset : dataset,
          west : expectedBounds[0],
          south : expectedBounds[1],
          east : expectedBounds[2],
          north : expectedBounds[3],
          count : 0,
          size : 0
        }
        t.deepEqual(info, expected, 'expected metadata');
        t.end();
    }
});
teardown();

setup();
test('insert idaho feature, update & check metadata', function(t) {
    var cardboard = new Cardboard(config);
    var original = geojsonFixtures.featurecollection.idaho.features[0];
    var edited = geojsonFixtures.feature.one;

    var expectedSize;
    var expectedBounds = geojsonExtent({
        type: 'FeatureCollection', 
        features: [original, edited]
    });

    cardboard.put(original, dataset, inserted);

    function inserted(err, res) {
        t.notOk(err, 'no error returned');
        t.pass('inserted idaho feature');

        var update = _.extend({ id: res.id }, edited);
        expectedSize = JSON.stringify(edited).length;
        cardboard.put(update, dataset, res.timestamp, updated);
    }

    function updated(err, res) {
        t.ifError(err, 'updated feature');
        metadata.getInfo(checkInfo);
    }

    function checkInfo(err, info) {
        t.ifError(err, 'got idaho metadata');
        var expected = {
          id : "metadata!" + dataset,
          dataset : dataset,
          west : expectedBounds[0],
          south : expectedBounds[1],
          east : expectedBounds[2],
          north : expectedBounds[3],
          count : 0,
          size : 0
        }
        t.deepEqual(info, expected, 'expected metadata');
        t.end();
    }
});
teardown();

setup();
test('delDataset removes metadata', function(t) {
    var cardboard = new Cardboard(config);
    dyno.putItem(initial, function(err) {
        t.ifError(err, 'put initial metadata');
        cardboard.delDataset(dataset, removed);
    });

    function removed(err) {
        t.ifError(err, 'removed dataset');
        metadata.getInfo(function(err, info) {
            t.ifError(err, 'looked for metadata');
            t.deepEqual(info, {}, 'metadata was removed');
            t.end();
        });
    }
});
teardown();

setup();
test('getDatasetInfo', function(t) {
    var cardboard = new Cardboard(config);
    dyno.putItem(initial, function(err) {
        t.ifError(err, 'put initial metadata');
        cardboard.getDatasetInfo(dataset, checkInfo);
    });

    function checkInfo(err, info) {
        t.ifError(err, 'got metadata');
        t.deepEqual(info, initial, 'metadata is correct');
        t.end();
    }
});
teardown();

// Retryability
setup();
test('idempotent insert: no feature id fail', function(t) {
    var feature = fixtures.nullIsland;
    var dataset = 'default';
    var cardboard = new Cardboard(config);

    cardboard.insert(feature, dataset, function(err, res) {
        t.ok(err, 'expected error');
        t.equal(err.message, 'Feature does not specify an id', 'expected error message');
        countRecords(insertAgain);
    });

    function countRecords(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 0, 'no records');
            callback();
        });
    }

    function insertAgain() {
        cardboard.insert(feature, dataset, function(err, res) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'Feature does not specify an id', 'expected error message');
            countRecords(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent insert: s3 fail', function(t) {
    var idaho = geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0];
    var feature = _.extend({id: 'null'}, idaho);
    var dataset = 'default';
    var borkedS3 = {
        putObject: function(params, callback) {
            callback(new Error('I will never work'));
        }
    };
    var cardboard = new Cardboard(_.defaults({ s3: borkedS3 }, config));
    
    cardboard.insert(feature, dataset, function(err, res) {
        t.ok(err, 'expected error');
        t.equal(err.message, 'I will never work', 'expected error message');
        countRecords(insertAgain);
    });

    function countRecords(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 0, 'no records');
            callback();
        });
    }

    function insertAgain() {
        cardboard.insert(feature, dataset, function(err, res) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'I will never work', 'expected error message');
            countRecords(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent insert: dynamo fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var dataset = 'default';
    var borkedDyno = {
        putItem: function(item, options, callback) {
            callback(new Error('I will never work'));
        }
    };
    var borkedCardboard = new Cardboard(_.defaults({ dyno: borkedDyno }, config));
    var cardboard = new Cardboard(config);
    
    borkedCardboard.insert(feature, dataset, function(err, res) {
        t.ok(err, 'expected error');
        t.equal(err.message, 'I will never work', 'expected error message');
        countRecords(insertAgain);
    });

    function countRecords(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 0, 'no records');
            callback();
        });
    }

    function insertAgain() {
        borkedCardboard.insert(feature, dataset, function(err, res) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'I will never work', 'expected error message');
            countRecords(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent insert: default metadata fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var dataset = 'default';
    var borkedMetadata = {
        defaultInfo: function(callback) {
            callback(new Error('I will never work'));
        }
    };
    var cardboard = new Cardboard(_.defaults({ metadata: borkedMetadata }, config));
    var item;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ok(err, 'expected error');
        t.equal(err.message, 'I will never work', 'expected error message');
        checkDatabase(insertAgain);
    });

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 1, 'one record');
            if (item) {
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(res.items[0], 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, res.items[0].val), 'identical buffers');
            }
            else item = res.items[0];
            callback();
        });
    }

    function insertAgain() {
        cardboard.insert(feature, dataset, function(err, res) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'I will never work', 'expected error message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent insert: adjustBounds fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var dataset = 'default';
    var validMetadata = Metadata(dyno, dataset);
    var borkedMetadata = {
        defaultInfo: validMetadata.defaultInfo,
        adjustBounds: function(bounds, callback) {
            callback(new Error('I will never work'));
        }
    };
    var cardboard = new Cardboard(_.defaults({ metadata: borkedMetadata }, config));
    var item, metadata;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ok(err, 'expected error');
        t.equal(err.message, 'I will never work', 'expected error message');
        checkDatabase(insertAgain);
    });

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'one record');
            
            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }

            callback();
        });
    }

    function insertAgain() {
        cardboard.insert(feature, dataset, function(err, res) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'I will never work', 'expected error message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent insert: success', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var dataset = 'default';
    var cardboard = new Cardboard(config);
    var item, metadata;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        checkDatabase(insertAgain);
    });

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function insertAgain() {
        cardboard.insert(feature, dataset, function(err, res) {
            t.ifError(err, 'inserted again');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent insert: success with state change between inserts', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var dataset = 'default';
    var cardboard = new Cardboard(config);
    var item, metadata;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        feature.properties.newProp = 'bananas';
        cardboard.update(feature, dataset, res.timestamp, function(err) {
            t.ifError(err, 'updated');
            checkDatabase(insertAgain);
        });
    });

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function insertAgain() {
        cardboard.insert(feature, dataset, function(err, res) {
            t.ifError(err, 'inserted again');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: no feature id fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var dataset = 'default';
    var cardboard = new Cardboard(config);
    var item, metadata, timestamp;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        timestamp = res.timestamp;
        firstUpdate();
    });

    function firstUpdate() {
        delete feature.id;
        cardboard.update(feature, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'Feature does not specify an id', 'expected message');
            checkDatabase(updateAgain);
        });
    }

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function updateAgain() {
        cardboard.update(feature, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'Feature does not specify an id', 'expected message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: s3 fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var idaho = _.extend({id: 'null'}, geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0]);

    var dataset = 'default';
    var borkedS3 = {
        putObject: function(params, callback) {
            callback(new Error('I will never work'));
        }
    };
    var cardboard = new Cardboard(_.defaults({ s3: borkedS3 }, config));
    var item, metadata, timestamp;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        timestamp = res.timestamp;
        firstUpdate();
    });

    function firstUpdate() {
        cardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'I will never work', 'expected message');
            checkDatabase(updateAgain);
        });
    }

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function updateAgain() {
        cardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'I will never work', 'expected message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: dynamo fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var idaho = _.extend({id: 'null'}, geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0]);

    var dataset = 'default';
    var borkedDyno = {
        updateItem: function(key, item, opts, callback) {
            callback(new Error('I will never work'));
        }
    };
    var borkedCardboard = new Cardboard(_.defaults({ dyno: borkedDyno }, config));
    var cardboard = new Cardboard(config);
    var item, metadata, timestamp;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        timestamp = res.timestamp;
        firstUpdate();
    });

    function firstUpdate() {
        borkedCardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expectedError');
            t.equal(err.message, 'I will never work', 'expected message');
            checkDatabase(updateAgain);
        });
    }

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function updateAgain() {
        borkedCardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.message, 'I will never work', 'expected message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: metadata defaultInfo fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var idaho = _.extend({id: 'null'}, geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0]);

    var dataset = 'default';
    var borkedMetadata = {
        defaultInfo: function(callback) {
            callback(new Error('I will never work'));
        }
    };
    var borkedCardboard = new Cardboard(_.defaults({ metadata: borkedMetadata }, config));
    var cardboard = new Cardboard(config);
    var item, metadata, timestamp;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        timestamp = res.timestamp;
        firstUpdate();
    });

    function firstUpdate() {
        borkedCardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expectedError');
            t.equal(err.message, 'I will never work', 'expected message');
            checkDatabase(updateAgain);
        });
    }

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function updateAgain() {
        borkedCardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            // Second time around, timestamp is out of date because first update succeeded
            t.equal(err.code, 'ConditionalCheckFailedException', 'expected message');
            // but what's important is that the database does not change state the second time
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: metadata adjustBounds fail', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var idaho = _.extend({id: 'null'}, geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0]);

    var dataset = 'default';
    var borkedMetadata = {
        defaultInfo: Metadata(dyno, dataset).defaultInfo,
        adjustBounds: function(bounds, callback) {
            callback(new Error('I will never work'));
        }
    };
    var borkedCardboard = new Cardboard(_.defaults({ metadata: borkedMetadata }, config));
    var cardboard = new Cardboard(config);
    var item, metadata, timestamp;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        timestamp = res.timestamp;
        firstUpdate();
    });

    function firstUpdate() {
        borkedCardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expectedError');
            t.equal(err.message, 'I will never work', 'expected message');
            checkDatabase(updateAgain);
        });
    }

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function updateAgain() {
        borkedCardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            // Second time around, timestamp is out of date because first update succeeded
            t.equal(err.code, 'ConditionalCheckFailedException', 'expected message');
            // but what's important is that the database does not change state the second time
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: out-of-order update', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var idaho = _.extend({id: 'null'}, geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0]);

    var dataset = 'default';
    var cardboard = new Cardboard(config);
    var item, metadata;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        firstUpdate();
    });

    function firstUpdate() {
        cardboard.update(idaho, dataset, 12, function(err) {
            t.ok(err, 'expectedError');
            t.equal(err.code, 'ConditionalCheckFailedException', 'expected message');
            checkDatabase(updateAgain);
        });
    }

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function updateAgain() {
        cardboard.update(idaho, dataset, 12, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.code, 'ConditionalCheckFailedException', 'expected message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: item does not exist', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var idaho = _.extend({id: 'null'}, geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0]);
    var dataset = 'default';
    var cardboard = new Cardboard(config);
    var item, metadata;

    cardboard.update(idaho, dataset, 12, function(err) {
        t.ok(err, 'expected error');
        t.equal(err.code, 'ConditionalCheckFailedException', 'expected message');
        checkDatabase(updateAgain);
    });

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 0, 'no records');
            callback();
        });
    }

    function updateAgain() {
        cardboard.update(idaho, dataset, 12, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.code, 'ConditionalCheckFailedException', 'expected message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();

setup();
test('idempotent update: successful update', function(t) {
    var feature = _.extend({id: 'null'}, fixtures.nullIsland);
    var idaho = _.extend({id: 'null'}, geojsonFixtures.featurecollection.idaho.features.filter(function(f) {
        return f.properties.GEOID === '16049960100';
    })[0]);

    var dataset = 'default';
    var cardboard = new Cardboard(config);
    var item, metadata, timestamp;

    cardboard.insert(feature, dataset, function(err, res) {
        t.ifError(err, 'inserted');
        timestamp = res.timestamp;
        firstUpdate();
    });

    function firstUpdate() {
        cardboard.update(idaho, dataset, timestamp, function(err) {
            t.ifError(err, 'updated')
            checkDatabase(updateAgain);
        });
    }

    function checkDatabase(callback) {
        cardboard.dump(function(err, res) {
            t.ifError(err, 'dumped');
            t.equal(res.count, 2, 'two records');

            var thisItem = _.find(res.items, function(i) { 
                return i.id.indexOf('id') === 0;
            });
            var thisMetadata = _.find(res.items, function(i) {
                return i.id.indexOf('metadata') === 0;
            });

            if (item && metadata) {
                t.deepEqual(thisMetadata, metadata, 'identical metadata');
                var oldItem = _.omit(item, 'val');
                var newItem = _.omit(thisItem, 'val');
                t.deepEqual(newItem, oldItem, 'identical records');
                if (item.val)
                    t.ok(bufferEqual(item.val, thisItem.val), 'identical buffers');
            } else {
                item = thisItem;
                metadata = thisMetadata;
            }
            callback();
        });
    }

    function updateAgain() {
        cardboard.update(idaho, dataset, timestamp, function(err) {
            t.ok(err, 'expected error');
            t.equal(err.code, 'ConditionalCheckFailedException', 'expected message');
            checkDatabase(t.end.bind(t));
        });
    }
});
teardown();