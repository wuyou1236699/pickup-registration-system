import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Registration from '../../src/components/Registration'
import { emptyState, register, type Person, type RegistrationResult } from '../../src/domain/pickup'
import '../../src/index.css'
const people:Person[]=[{id:'fake-group-a',name:'示例甲',company:'虚构企业甲',source:{sheet:'示例',row:2,cell:'B2',group:'',learningGroup:'示例学习组甲'}},{id:'fake-group-b',name:'示例乙',company:'虚构企业乙',source:{sheet:'示例',row:3,cell:'B3',group:'',learningGroup:''}},{id:'fake-group-c',name:'示例丙',company:'虚构企业丙',source:{sheet:'示例',row:4,cell:'B4',group:'旧来源组'}}]
function Fixture(){const[state,setState]=useState(emptyState());const[selected,setSelected]=useState<string[]>([]);const[result,setResult]=useState<RegistrationResult|null>(null);return <Registration people={people} state={state} selected={selected} setSelected={setSelected} result={result} busy={false} blocked={false} server={false} submit={()=>{const r=register(state,selected,people);setState(r.state);setResult(r.result)}} next={()=>{setSelected([]);setResult(null)}}/>}
createRoot(document.getElementById('root')!).render(<Fixture/> )
