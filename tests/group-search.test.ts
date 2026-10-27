import {it,expect} from 'vitest'
import {searchPeople,type Person} from '../src/domain/pickup'
const people:Person[]=[
 {id:'group-a',name:'示例甲',company:'虚构企业甲',source:{sheet:'示例',row:2,cell:'B2',group:'旧来源标题',learningGroup:' 学习一组'}},
 {id:'group-b',name:'示例乙',company:'虚构企业乙',source:{sheet:'示例',row:3,cell:'B3',group:'',learningGroup:''}},
 {id:'group-c',name:'示例丙',company:'虚构企业丙',source:{sheet:'示例',row:4,cell:'B4',group:'',learningGroup:'学习一组'}},
 {id:'group-d',name:'示例丁',company:'虚构企业丁',source:{sheet:'示例',row:5,cell:'B5',group:''}},
]
it('学习小组完整及部分匹配；空值不匹配，旧来源组不冒充学习小组',()=>{
 expect(searchPeople(people,' 学习一组 ')).toEqual([people[0],people[2]])
 expect(searchPeople(people,'一组')).toEqual([people[0],people[2]])
 expect(searchPeople(people,'旧来源标题')).toEqual([])
 expect(people[0].source.learningGroup).toBe(' 学习一组')
})
it('姓名、公司和空搜索行为保持不变',()=>{
 expect(searchPeople(people,'示例乙')).toEqual([people[1]])
 expect(searchPeople(people,'虚构企业丁')).toEqual([people[3]])
 expect(searchPeople(people,'')).toEqual(people)
})
