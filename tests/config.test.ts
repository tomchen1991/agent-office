import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficeConfig, importOfficeConfig, exportOfficeConfig } from '../src/config.ts';
import type { OfficeConfig, SeatConfig } from '../src/config.ts';
const seat = (id: string, sourceId = 'synthetic-source'): SeatConfig => ({id,name:id,character:'unknown',selector:{sourceId,instanceId:id,epoch:{policy:'follow-unique'}}});
const config = (): OfficeConfig => ({version:1,seats:[seat('own'),seat('child'),seat('lead')],office:{selfSeatId:'own',childSeatIds:['child'],team:{layout:'leader-desks',memberSeatIds:['lead'],leaderSeatId:'lead'}}});
test('strict config roundtrips into independent normalized data', () => {
  const input = config(), result = importOfficeConfig(exportOfficeConfig(input));
  assert.deepEqual(result,input); assert.notEqual(result.seats,input.seats);
  assert.equal(exportOfficeConfig(result),exportOfficeConfig(input));
});
test('malformed JSON, versions, missing objects and oversized input rejected', () => {
  for (const value of [null,[],{}, {...config(),version:2}, {...config(),office:null}]) assert.throws(()=>parseOfficeConfig(value));
  assert.throws(()=>importOfficeConfig('{bad'));
  assert.throws(()=>importOfficeConfig(' '.repeat(128 * 1024 + 1)));
});
test('unknown fields including credentials and URLs rejected recursively', () => {
  const data = config();
  for (const value of [ {...data,token:'synthetic'}, {...data,url:'https://example.invalid'},
    {...data,seats:[{...data.seats[0],secret:'synthetic'},...data.seats.slice(1)]},
    {...data,seats:[{...data.seats[0],selector:{...data.seats[0].selector,url:'https://example.invalid'}},...data.seats.slice(1)]},
    {...data,office:{...data.office,team:{...data.office.team,token:'synthetic'}}},
  ]) assert.throws(()=>parseOfficeConfig(value),/Unknown/);
  const malicious = JSON.parse(exportOfficeConfig(data)); malicious.__proto__ = {token:'synthetic'};
  assert.throws(()=>parseOfficeConfig(malicious),/plain/);
});
test('duplicate, missing, unassigned logical seats and conflicting office assignment rejected', () => {
  const data = config();
  assert.throws(()=>parseOfficeConfig({...data,seats:[...data.seats,seat('own')]}),/Duplicate/);
  assert.throws(()=>parseOfficeConfig({...data,seats:[...data.seats,seat('extra')]}),/unassigned/);
  assert.throws(()=>parseOfficeConfig({...data,office:{...data.office,selfSeatId:'missing'}}),/Missing/);
  assert.throws(()=>parseOfficeConfig({...data,office:{...data.office,childSeatIds:['own']}}),/Duplicate/);
});
test('leader membership explicit; peer table rejects hidden leader property', () => {
  const data = config();
  assert.throws(()=>parseOfficeConfig({...data,office:{...data.office,team:{...data.office.team,leaderSeatId:'own'}}}),/Leader/);
  assert.throws(()=>parseOfficeConfig({...data,office:{...data.office,team:{layout:'leader-desks',memberSeatIds:['lead']}}}));
  assert.throws(()=>parseOfficeConfig({...data,office:{...data.office,team:{...data.office.team,layout:'peer-table'}}}));
  assert.doesNotThrow(()=>parseOfficeConfig({...data,office:{...data.office,team:{layout:'peer-table',memberSeatIds:['lead']}}}));
});
test('overlapping follow policies conflict; distinct exact epochs and sources are independent', () => {
  const data = config(); const first = data.seats[0];
  const second = {...data.seats[1],selector:first.selector};
  assert.throws(()=>parseOfficeConfig({...data,seats:[first,second,data.seats[2]]}),/Conflicting/);
  const exact = {...first,selector:{...first.selector,epoch:{policy:'exact' as const,value:'epoch-1'}}};
  assert.throws(()=>parseOfficeConfig({...data,seats:[exact,second,data.seats[2]]}),/Conflicting/);
  const otherEpoch = {...second,selector:{...exact.selector,epoch:{policy:'exact' as const,value:'epoch-2'}}};
  assert.doesNotThrow(()=>parseOfficeConfig({...data,seats:[exact,otherEpoch,data.seats[2]]}));
  const otherSource = {...second,selector:{...second.selector,sourceId:'independent-source'}};
  assert.doesNotThrow(()=>parseOfficeConfig({...data,seats:[first,otherSource,data.seats[2]]}));
});
test('text, lengths, list limits, enum and epoch fields are validated', () => {
  const data = config();
  for (const first of [{...data.seats[0],id:' '},{...data.seats[0],name:'x'.repeat(101)},{...data.seats[0],id:'bad\nname'},{...data.seats[0],character:'invented'}, {...data.seats[0],selector:{sourceId:'s',instanceId:'i',epoch:{policy:'follow-unique',value:'extra'}}}]) assert.throws(()=>parseOfficeConfig({...data,seats:[first,...data.seats.slice(1)]}));
  assert.throws(()=>parseOfficeConfig({...data,seats:Array.from({length:129},(_,i)=>seat(`s${i}`))}));
});
test('config parse refuses accessors and symbol fields without executing getters', () => {
  let ran = false;
  const data = {...config()}; Object.defineProperty(data,'seats',{get(){ran=true;return[];},enumerable:true});
  assert.throws(()=>parseOfficeConfig(data),/accessors/); assert.equal(ran,false);
  assert.throws(()=>parseOfficeConfig({...config(),[Symbol('private')]:1}),/Unknown/);
});

test('array extensions, sparse lists and non-string character impostors rejected', () => {
  const data = config(); const extended = Object.assign([...data.seats],{token:'synthetic'});
  assert.throws(()=>parseOfficeConfig({...data,seats:extended}),/list/);
  assert.throws(()=>parseOfficeConfig({...data,seats:new Array(3)}),/list/);
  assert.throws(()=>parseOfficeConfig({...data,seats:[{...data.seats[0],character:{toString:()=> 'self'}},...data.seats.slice(1)]}),/character/);
});
