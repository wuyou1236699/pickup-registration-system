import type { Workbook } from 'exceljs'
import type { Person } from '../shared/contracts'
export function parseFormalRoster(workbook: Workbook, volunteerNames?: string[]): {people:Person[]; sheets:{name:string;count:number}[]}
