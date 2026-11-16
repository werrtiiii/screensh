const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createEasyTierFirewall } = require('../main/easytier-firewall.cjs');

test('interface identity is stable per installation and isolated from other installations', () => {
  const make = installRoot => createEasyTierFirewall({ installRoot, backupDirectory: path.resolve('backup'), platform: 'linux' });
  assert.equal(make('A').interfaceName, make('a').interfaceName);
  assert.notEqual(make('A').interfaceName, make('B').interfaceName);
  assert.match(make('A').interfaceName, /^ScreenSh-[a-f0-9]{16}$/);
});

test('cleanup is serialized, uses an encoded fixed script, and failures do not prevent joining', async () => {
  const calls = [], warnings = [];
  const firewall = createEasyTierFirewall({installRoot:'test',backupDirectory:"E:\\test's backup",platform:'win32',warn:value=>warnings.push(value),execute:(...args)=>calls.push(args)});
  const first = firewall.cleanup(), second = firewall.cleanup();
  assert.equal(first, second);
  const command = Buffer.from(calls[0][1].at(-1), 'base64').toString('utf16le');
  assert.ok(command.includes('-Apply -InterfaceName'));
  assert.ok(command.includes("E:\\test''s backup"));
  assert.ok(!command.includes('-Legacy -Apply'));
  calls[0].at(-1)(Error('access denied'), '');
  await first;
  assert.deepEqual(warnings, ['access denied']);
  const retry = firewall.cleanup();
  calls[1].at(-1)(null, '{"removed":0}');
  assert.deepEqual(await retry, {removed:0});
});

test('PowerShell selector protects current/hidden adapters, program rules, ambiguous names and other applications', {skip:process.platform!=='win32'}, () => {
  // Execute the production selector. Replace only OS reads with in-memory fixtures;
  // no firewall mutation or network adapter creation is performed by this test.
  const script = fs.readFileSync(path.join(__dirname,'../main/easytier-firewall.ps1'),'utf8')
    .replace('New-Object -ComObject HNetCfg.FwPolicy2', '$global:FakePolicy')
    .replace('Get-NetAdapter -IncludeHidden -ErrorAction Stop', '$global:FakeAdapters');
  const prefix = `
$ProgressPreference='SilentlyContinue'
function Rule($adapter,$iface,$group='EasyTier',$app='') {
 [PSCustomObject]@{Name="EasyTier $adapter - TCP Protocol (Inbound)";Grouping=$group;ApplicationName=$app;Action=1;Protocol=6;Direction=1;Interfaces=@($iface)}
}
$global:FakeAdapters=@([PSCustomObject]@{Name='et_current';InterfaceGuid='{11111111-1111-1111-1111-111111111111}'})
$global:FakePolicy=[PSCustomObject]@{Rules=@(
 (Rule 'et_gone' '{22222222-2222-2222-2222-222222222222}'),
 (Rule 'et_gone_name' 'et_gone_name'),
 (Rule 'et_current' 'et_current'),
 (Rule 'et_hidden' '{11111111-1111-1111-1111-111111111111}'),
 (Rule 'et_other' 'et_other' 'Another app'),
 (Rule 'et_program' 'et_program' 'EasyTier' 'other.exe'),
 (Rule 'et_unbound' ''),
 (Rule 'et_duplicate' 'et_duplicate'),
 (Rule 'et_duplicate' 'et_duplicate'),
 (Rule 'ScreenSh-0123456789abcdef' 'ScreenSh-0123456789abcdef')
)}
`;
  const command = prefix + '\n& {\n' + script + '\n} -Legacy';
  const executable = path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const output = execFileSync(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000});
  const result = JSON.parse(output.trim());
  assert.equal(result.candidates,2);
  assert.equal(result.removed,0);
});
