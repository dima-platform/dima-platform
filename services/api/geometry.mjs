// GeoJSON uses [longitude, latitude]. Boundaries of exterior rings are included;
// interiors and edges of holes are excluded. No bounding-box-only acceptance.
function ringPosition(point,ring){
 const [x,y]=point;let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [ax,ay]=ring[j],[bx,by]=ring[i];
  const cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
  if(Math.abs(cross)<=1e-10&&x>=Math.min(ax,bx)-1e-10&&x<=Math.max(ax,bx)+1e-10&&y>=Math.min(ay,by)-1e-10&&y<=Math.max(ay,by)+1e-10)return 2;
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside?1:0;
}
export function contains(geometry,longitude,latitude){
 if(!geometry||!Number.isFinite(longitude)||!Number.isFinite(latitude))return false;
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 return polygons.some(rings=>rings?.length&&rings[0].length>=4&&ringPosition([longitude,latitude],rings[0])!==0&&rings.slice(1).every(r=>ringPosition([longitude,latitude],r)===0));
}
