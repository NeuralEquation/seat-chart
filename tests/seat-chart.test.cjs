// Code-level regression checks with a minimal DOM stub. No browser or GUI is used.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../seat-chart-template.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
function boot(initial = {}, fail = false) {
  const nodes = new Map(), all = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName=tag; this.children=[]; this.dataset={}; this.style={}; this.listeners={};
      this.value=''; this.textContent=''; this.open=false; this.isConnected=true;
      const classes=new Set();
      this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),toggle:(k,on)=>on?classes.add(k):classes.delete(k),contains:k=>classes.has(k)};
      all.push(this);
    }
    get options() { return this.children; }
    setAttribute(k,v) { this[k]=v; }
    append(...children) { children.forEach(c=>{c.parentElement=this;this.children.push(c);}); }
    appendChild(c) { this.append(c); }
    replaceChildren(...children) { this.children=[];this.append(...children); }
    addEventListener(k,f) { (this.listeners[k]??=[]).push(f); }
    fire(k,e={}) { for(const f of this.listeners[k]||[]) f({preventDefault(){},...e}); }
    querySelectorAll() { return this.children.filter(c=>c.tagName==='button'); }
    querySelector() { return this; }
    focus() { document.activeElement=this; }
    select() {}
    showModal() { this.open=true; }
    close() { this.open=false;this.fire('close'); }
  }
  for(const m of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)) nodes.set(m[2],new Element(m[1]));
  const help = new Element();
  const document={
    activeElement:null,
    getElementById:id=>nodes.get(id),
    createElement:tag=>new Element(tag),
    querySelectorAll:q=>q==='dialog'?[...nodes.values()].filter(x=>x.tagName==='dialog'):q==='[data-seat-id]'?all.filter(x=>x.dataset.seatId):[],
    querySelector:q=>q==='.chart-help'?help:[...nodes.values()].find(x=>x.tagName==='dialog'&&x.open),
    addEventListener(){}
  };
  const data=new Map(Object.entries(initial));
  const storage={fail,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw Error('quota');data.set(k,v);}};
  const context=vm.createContext({document,localStorage:storage,window:{crypto:require('node:crypto').webcrypto,confirm:()=>true,print(){}},Option:class extends Element {constructor(text,value){super('option');this.textContent=text;this.value=value;}},setTimeout:f=>f(),console});
  vm.runInContext(script,context);
  return {run:code=>vm.runInContext(code,context),nodes,storage,data};
}
let passed=0;
function test(name,fn){ fn();passed++;console.log('PASS '+name); }
test('38 seats, single controls, no legacy script',()=>{
 const x=boot();assert.equal(x.run('Object.keys(blankData()).length'),38);
 assert.equal((html.match(/id="presetButton"/g)||[]).length,1);
 assert.ok(!html.includes('presetButtonBottom'));assert.ok(!html.includes('data-legacy-script'));
});
test('migration keeps legacy originals and working names',()=>{
 const old=JSON.stringify({'left-1-2':'佐藤'});
 const x=boot({'simpleSeatChart.v1':old,'simpleSeatChart.history.v1':JSON.stringify([{data:{'left-1-2':'鈴木'}}])});
 assert.equal(x.run('state.workingData["left-1-2"]'),'佐藤');
 assert.equal(x.run('activePreset().history[0].data["left-1-2"]'),'鈴木');
 assert.equal(x.data.get('simpleSeatChart.v1'),old);
});
test('malformed JSON and invalid preset arrays do not crash',()=>{
 for(const value of ['{',JSON.stringify({version:2,presets:[null,{}]}),JSON.stringify({version:2,presets:[{id:'a',history:[null,{}, {data:{}}]}]})]){
  const x=boot({'simpleSeatChart.v2':value});assert.ok(x.run('activePreset().id'));
 }
});
test('duplicate IDs repaired',()=>{
 const x=boot({'simpleSeatChart.v2':JSON.stringify({version:2,presets:[{id:'same'},{id:'same'}]})});
 assert.equal(x.run('new Set(state.presets.map(p=>p.id)).size'),2);
});
test('input auto-save, change marker, undo and redo',()=>{
 const x=boot();const input=x.run('document.querySelectorAll("[data-seat-id]")[0]');input.value='佐藤';input.fire('input');
 assert.equal(x.run('isDirty()'),true);assert.equal(input.parentElement.classList.contains('changed'),true);
 x.nodes.get('undoButton').fire('click');assert.equal(input.value,'');
 x.nodes.get('redoButton').fire('click');assert.equal(input.value,'佐藤');
 assert.equal(JSON.parse(x.data.get('simpleSeatChart.v2')).workingData['left-1-2'],'佐藤');
});
test('save creates before and after history, unchanged save adds none',()=>{
 const x=boot();x.run('state.workingData["left-1-2"]="佐藤";savePreset()');
 assert.equal(x.run('activePreset().history.length'),2);
 assert.equal(x.run('activePreset().history[1].data["left-1-2"]'),'');
 x.run('savePreset()');assert.equal(x.run('activePreset().history.length'),2);
});
test('quota failure rolls preset back and keeps dirty work',()=>{
 const x=boot();x.storage.fail=true;x.run('state.workingData["left-1-2"]="佐藤";savePreset()');
 assert.equal(x.run('activePreset().data["left-1-2"]'),'');assert.equal(x.run('isDirty()'),true);
 assert.match(x.nodes.get('savedStatus').textContent,/失敗/);
 x.storage.fail=false;assert.equal(x.run('savePreset()'),true);
});
test('duplicate does not discard unsaved input',()=>{
 const x=boot();x.run('state.workingData["left-1-2"]="佐藤"');const id=x.run('state.activePresetId');
 x.nodes.get('duplicateButton').fire('click');assert.equal(x.run('state.activePresetId'),id);assert.equal(x.run('state.workingData["left-1-2"]'),'佐藤');
});
test('switch cancel and save failure keep current selection',()=>{
 const x=boot();x.run('state.presets.push(makePreset("次",{}));state.workingData["left-1-2"]="佐藤";requestSwitch(state.presets[1].id)');
 assert.equal(x.nodes.get('switchDialog').open,true);x.nodes.get('switchDialog').fire('cancel');assert.equal(x.run('pendingSwitch'),null);
 x.run('requestSwitch(state.presets[1].id)');const id=x.run('state.activePresetId');x.storage.fail=true;
 x.nodes.get('switchSaveButton').fire('click');assert.equal(x.run('state.activePresetId'),id);
});
test('comparison includes removals and ignores nonexistent seats',()=>{
 const x=boot();assert.equal(x.run('diffData({"left-1-2":"佐藤"},{})[0].type'),'removed');
 assert.equal(x.run('diffData({},{"left-1-1":"不存在"}).length'),0);
});
test('merge requires explicit choice for blank vs name',()=>{
 const x=boot();x.run('state.presets.push(makePreset("B",{"left-1-2":"佐藤"}));renderPresetSelects()');
 x.nodes.get('mergeA').value=x.run('state.presets[0].id');x.nodes.get('mergeB').value=x.run('state.presets[1].id');x.run('renderMerge()');
 assert.equal(x.nodes.get('mergeSaveButton').disabled,true);
 assert.equal(x.run('Object.keys(mergeConflicts).length'),1);
});
test('delete last preset leaves valid active preset and preserves dirty work',()=>{
 const x=boot();x.run('state.workingData["left-1-2"]="佐藤"');x.nodes.get('deleteButton').fire('click');
 assert.ok(x.run('activePreset().id'));assert.equal(x.run('state.workingData["left-1-2"]'),'佐藤');
});
test('clear undo and IME Enter do not lose input',()=>{
 const x=boot();x.run('state.workingData["left-1-2"]="佐藤";updateStatus()');x.nodes.get('clearButton').fire('click');x.nodes.get('undoButton').fire('click');
 assert.equal(x.run('state.workingData["left-1-2"]'),'佐藤');
 const input=x.run('document.querySelectorAll("[data-seat-id]")[0]');input.focus();input.fire('keydown',{key:'Enter',isComposing:true});assert.equal(x.run('document.activeElement'),input);
});
test('restoring history updates inputs and leaves saved history untouched',()=>{
 const x=boot();x.run('state.workingData["left-1-2"]="佐藤";savePreset();state.workingData["left-1-2"]="鈴木";savePreset();renderHistory()');
 const count=x.run('activePreset().history.length');
 const entry=x.nodes.get('historyList').children[1];
 entry.children[1].children[1].fire('click');
 assert.equal(x.run('state.workingData["left-1-2"]'),'佐藤');
 assert.equal(x.run('document.querySelectorAll("[data-seat-id]")[0].value'),'佐藤');
 assert.equal(x.run('activePreset().history.length'),count);
 x.run('savePreset()');assert.equal(x.run('activePreset().history.length'),count+1);
});
test('merge resolved blank is kept and save does not change working preset',()=>{
 const x=boot();x.run('state.presets.push(makePreset("B",{"left-1-2":"佐藤"}));renderPresetSelects()');
 const id=x.run('state.activePresetId');
 x.nodes.get('mergeA').value=id;x.nodes.get('mergeB').value=x.run('state.presets[1].id');x.run('renderMerge()');
 const conflict=x.nodes.get('mergeConflicts').children[1];conflict.children[1].children[0].fire('click');
 assert.equal(x.nodes.get('mergeSaveButton').disabled,false);
 x.nodes.get('mergeSaveButton').fire('click');x.nodes.get('nameInput').value='統合';x.nodes.get('nameForm').fire('submit');
 assert.equal(x.run('state.presets[0].data["left-1-2"]'),'');
 assert.equal(x.run('state.activePresetId'),id);assert.equal(x.run('state.presets.length'),3);
});
test('switch refreshes names and persisted reload keeps working data',()=>{
 const x=boot();x.run('state.presets.push(makePreset("次",{"left-1-2":"佐藤"}));switchPreset(state.presets[1].id)');
 assert.equal(x.run('document.querySelectorAll("[data-seat-id]")[0].value'),'佐藤');
 const y=boot(Object.fromEntries(x.data));assert.equal(y.run('activePreset().name'),'次');
});
test('original v2 backup preserved across reload',()=>{
 const original=JSON.stringify({version:2,presets:[null]});
 const x=boot({'simpleSeatChart.v2':original});assert.equal(x.data.get('simpleSeatChart.v2.backup'),original);
 const y=boot(Object.fromEntries(x.data));assert.equal(y.data.get('simpleSeatChart.v2.backup'),original);
});
console.log(passed+' code-level regression checks passed. No browser checks performed.');
