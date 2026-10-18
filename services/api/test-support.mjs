import {createHandler as handler,createServer as server} from './server.mjs';
const actors={'demo-customer':{id:'customer-1',role:'customer'},'demo-merchant':{id:'merchant-1',role:'merchant',storeId:'store-1'},'demo-courier':{id:'courier-1',role:'courier'},'demo-admin':{id:'admin-1',role:'admin'}};
export const createHandler=(options={})=>handler({actors,...options});
export const createServer=(options={})=>server({actors,...options});
