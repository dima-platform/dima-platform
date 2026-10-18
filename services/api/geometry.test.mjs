import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contains} from './geometry.mjs';
import {coverage,demoZones} from './delivery.mjs';
test('Nabeul reference polygon accepts an interior point and rejects Tunis and sea within the bbox',()=>{
 assert.equal(coverage({latitude:36.46,longitude:10.73},demoZones).length,1);
 assert.equal(coverage({latitude:36.8,longitude:10.18},demoZones).length,0);
 const z=demoZones[0];assert.ok(11>z.west&&11<z.east&&36.4>z.south&&36.4<z.north);
 assert.equal(coverage({latitude:36.4,longitude:11},demoZones).length,0);
 assert.equal(coverage({latitude:36.46,longitude:10.73},[{...z,geometry:null}]).length,0);
});
test('polygon holes, exterior boundaries, multipolygons and coordinate order',()=>{
 const outer=[[0,0],[5,0],[5,5],[0,5],[0,0]],hole=[[1,1],[2,1],[2,2],[1,2],[1,1]],p={type:'Polygon',coordinates:[outer,hole]};
 assert.equal(contains(p,3,3),true);assert.equal(contains(p,0,3),true);assert.equal(contains(p,1.5,1.5),false);assert.equal(contains(p,1,1.5),false);assert.equal(contains(p,6,3),false);
 assert.equal(contains({type:'MultiPolygon',coordinates:[p.coordinates,[[[10,10],[12,10],[12,12],[10,12],[10,10]]]]},11,11),true);
 assert.equal(contains(demoZones[0].geometry,36.46,10.73),false);
});
