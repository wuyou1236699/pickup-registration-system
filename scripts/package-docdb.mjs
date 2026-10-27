import {writeFile} from 'node:fs/promises'
import pkg from '../package.json' with {type:'json'}
await writeFile('dist/docdb/package.json',JSON.stringify({name:'pickup-docdb',private:true,type:'commonjs',main:'cloudfunctions/pickup-docdb/index.js',engines:{node:'>=20'},dependencies:{'@cloudbase/node-sdk':pkg.dependencies['@cloudbase/node-sdk']}},null,2)+'\n')
