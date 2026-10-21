param([switch]$EnableIPv6)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$policy = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters' -Name DisabledComponents -ErrorAction SilentlyContinue
$blocked = $null -ne $policy -and (($policy.DisabledComponents -band 0x10) -ne 0)
$physical = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')
$routes = @(Get-NetRoute -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' -or $_.DestinationPrefix -eq '::/0' })
$routed = @($physical | Where-Object { $routes.InterfaceIndex -contains $_.ifIndex })
if ($routed.Count -gt 0) { $physical = $routed }
$bindings = @(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object { $physical.Name -contains $_.Name })
$changed = @()
$failures = @()
if ($EnableIPv6 -and -not $blocked) {
  foreach ($binding in $bindings) {
    if (-not $binding.Enabled) {
      try { $binding | Enable-NetAdapterBinding -Confirm:$false; $changed += $binding.Name }
      catch { $failures += [pscustomobject]@{ name=$binding.Name; error=$_.Exception.Message } }
    }
  }
}
$attempts = 1
if ($changed.Count -gt 0) { $attempts = 20 }
$addresses = @()
for ($i=0; $i -lt $attempts; $i++) {
  $addresses = @(Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $physical.ifIndex -contains $_.InterfaceIndex -and $_.AddressState -eq 'Preferred' -and $_.IPAddress -match '^[23]' } | Select-Object -ExpandProperty IPAddress)
  if ($addresses.Count -gt 0) { break }
  if ($i -lt $attempts-1) { Start-Sleep -Milliseconds 500 }
}
$after = @(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object { $physical.Name -contains $_.Name })
[pscustomobject]@{
  policyBlocked=[bool]$blocked
  adapters=@($after | ForEach-Object { [pscustomobject]@{ name=$_.Name; enabled=[bool]$_.Enabled; changed=($changed -contains $_.Name) } })
  addresses=@($addresses)
  failures=@($failures)
} | ConvertTo-Json -Depth 5 -Compress
