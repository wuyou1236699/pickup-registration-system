import { writeFile } from 'node:fs/promises'
await writeFile('.local-runtime/docdb-tools/package.json', JSON.stringify({private:true,type:'commonjs'}) + '\n')
