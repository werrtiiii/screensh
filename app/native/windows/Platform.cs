using System;
using System.IO;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Management;
using System.Net.NetworkInformation;
using System.Security.Principal;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace ScreenSh.Windows
{
    static class Platform
    {
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct FrameMargins { public int Left, Right, Top, Bottom; }
        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref FrameMargins margins);
        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        internal static object WindowFrame(string handle, int owner, bool rounded)
        {
            var window = new IntPtr(Int64.Parse(handle));
            uint actualOwner;
            if (GetWindowThreadProcessId(window, out actualOwner) == 0 || actualOwner != owner)
                throw new ArgumentException("Invalid window owner");
            // Electron 29 loses these DWM attributes across native maximize/restore.
            var margins = new FrameMargins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
            System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(DwmExtendFrameIntoClientArea(window, ref margins));
            int corner = rounded ? 2 : 1, backdrop = 3;
            System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(DwmSetWindowAttribute(window, 33, ref corner, sizeof(int)));
            System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(DwmSetWindowAttribute(window, 38, ref backdrop, sizeof(int)));
            System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(DwmGetWindowAttribute(window, 33, out corner, sizeof(int)));
            System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(DwmGetWindowAttribute(window, 38, out backdrop, sizeof(int)));
            return new { corner = corner, backdrop = backdrop };
        }
        static object Get(ManagementObject row, string name)
        {
            return row.Properties[name] == null ? null : row[name];
        }
        static List<ManagementObject> Query(string text)
        {
            using (var search = new ManagementObjectSearcher("root\\StandardCimv2", text))
                return search.Get().Cast<ManagementObject>().ToList();
        }
        internal static object Ipv6(bool enable)
        {
            bool blocked = false;
            using (var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters"))
            {
                if (key != null)
                    blocked = (Convert.ToInt64(key.GetValue("DisabledComponents", 0)) & 0x10) != 0;
            }
            var nics = NetworkInterface.GetAllNetworkInterfaces();
            var physical = Query("SELECT * FROM MSFT_NetAdapter WHERE HardwareInterface=True").Where(a => nics.Any(n => n.OperationalStatus == OperationalStatus.Up && String.Equals(n.Id.Trim('{', '}'), Convert.ToString(Get(a, "InterfaceGuid")).Trim('{', '}'), StringComparison.OrdinalIgnoreCase))).ToList();
            var routed = physical.Where(a => nics.Any(n => Common.CI.Equals(n.Name, Convert.ToString(Get(a, "Name"))) && n.GetIPProperties().GatewayAddresses.Any(g => !g.Address.Equals(System.Net.IPAddress.Any) && !g.Address.Equals(System.Net.IPAddress.IPv6Any)))).ToList();
            if (routed.Count > 0)
                physical = routed;
            var bindings = Query("SELECT * FROM MSFT_NetAdapterBindingSettingData WHERE ComponentID='ms_tcpip6'");
            var results = new List<object>();
            var failures = new List<object>();
            bool changedAny = false;
            foreach (var a in physical)
            {
                string name = Convert.ToString(Get(a, "Name")), description = Convert.ToString(Get(a, "InterfaceDescription"));
                var binding = bindings.FirstOrDefault(b => Common.CI.Equals(Convert.ToString(Get(b, "Name")), name) || Common.CI.Equals(Convert.ToString(Get(b, "InterfaceDescription")), description));
                bool changed = false, enabled = binding != null && Convert.ToBoolean(Get(binding, "Enabled"));
                if (enable && !blocked && !enabled && binding != null)
                    try
                    {
                        var output = binding.InvokeMethod("Enable", binding.GetMethodParameters("Enable"), null);
                        if (Convert.ToUInt32(output["ReturnValue"]) != 0)
                            throw new IOException("Windows rejected IPv6 binding change");
                        binding.Get();
                        enabled = Convert.ToBoolean(Get(binding, "Enabled"));
                        changed = enabled;
                        changedAny |= changed;
                    }
                    catch (Exception e) { failures.Add(Common.Obj("name", name, "error", e.Message)); }
                results.Add(Common.Obj("name", name, "enabled", enabled, "changed", changed));
            }
            string[] addresses = new string[0];
            for (int i = 0; i < (changedAny ? 20 : 1); i++)
            {
                addresses = NetworkInterface.GetAllNetworkInterfaces().Where(n => physical.Any(a => Common.CI.Equals(n.Name, Convert.ToString(Get(a, "Name"))))).SelectMany(n => n.GetIPProperties().UnicastAddresses).Where(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 && (a.Address.ToString().StartsWith("2") || a.Address.ToString().StartsWith("3")) && a.DuplicateAddressDetectionState == DuplicateAddressDetectionState.Preferred).Select(a => a.Address.ToString()).ToArray();
                if (addresses.Length > 0)
                    break;
                if (changedAny)
                    System.Threading.Thread.Sleep(500);
            }
            foreach (var a in physical)
                a.Dispose();
            foreach (var b in bindings)
                b.Dispose();
            return Common.Obj("policyBlocked", blocked, "adapters", results, "addresses", addresses, "failures", failures);
        }
        internal static bool Login(string mode, string exe, string arguments, string directory)
        {
            if (mode != "get" && mode != "enable" && mode != "disable")
                throw new ArgumentException("Invalid startup operation");
            var identity = WindowsIdentity.GetCurrent();
            string name = "ScreenSh-" + identity.User.Value;
            dynamic service = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));
            service.Connect();
            dynamic folder = service.GetFolder("\\");
            if (mode == "enable")
            {
                if (!Path.IsPathRooted(exe) || !Path.IsPathRooted(directory))
                    throw new ArgumentException("Startup paths must be absolute");
                dynamic task = service.NewTask(0);
                task.RegistrationInfo.Description = "ScreenSh";
                task.Principal.UserId = identity.Name;
                task.Principal.LogonType = 3;
                task.Principal.RunLevel = 1;
                task.Settings.AllowDemandStart = true;
                task.Settings.DisallowStartIfOnBatteries = false;
                task.Settings.StopIfGoingOnBatteries = false;
                task.Settings.ExecutionTimeLimit = "PT0S";
                task.Settings.MultipleInstances = 2;
                task.Settings.StartWhenAvailable = true;
                dynamic trigger = task.Triggers.Create(9);
                trigger.UserId = identity.Name;
                trigger.Enabled = true;
                dynamic action = task.Actions.Create(0);
                action.Path = exe;
                action.Arguments = arguments;
                action.WorkingDirectory = directory;
                folder.RegisterTaskDefinition(name, task, 6, identity.Name, null, 3, null);
            }
            dynamic existing = null;
            try
            {
                existing = folder.GetTask(name);
            }
            catch (Exception e) { if (e.HResult != unchecked((int)0x80070002) && e.HResult != unchecked((int)0x80070003)) throw; }
            if (mode == "disable" && existing != null)
            {
                folder.DeleteTask(name, 0);
                return false;
            }
            return existing != null && existing.Enabled;
        }
        static HashSet<string> Interfaces()
        {
            var result = new HashSet<string>(Common.CI);
            // The CIM provider includes hidden/disabled adapters. Their rules
            // must remain protected even when IP Helper omits the interface.
            foreach (var adapter in Query("SELECT Name, InterfaceGuid FROM MSFT_NetAdapter"))
            {
                using (adapter)
                {
                    string name = Convert.ToString(Get(adapter, "Name"));
                    string id = Convert.ToString(Get(adapter, "InterfaceGuid"));
                    if (name != "") result.Add(name);
                    if (id != "") { result.Add(id); result.Add(id.Trim('{', '}')); result.Add("{" + id.Trim('{', '}') + "}"); }
                }
            }
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
            {
                result.Add(n.Name);
                result.Add(n.Id);
                result.Add(n.Id.Trim('{', '}'));
                result.Add("{" + n.Id.Trim('{', '}') + "}");
            }
            if (result.Count == 0)
                throw new IOException("Cannot inspect adapters safely");
            return result;
        }
        internal static List<Dictionary<string, object>> SelectFirewall(IEnumerable<Dictionary<string, object>> rules, HashSet<string> present, string iface, bool legacy)
        {
            var all = rules.ToList();
            var selected = new List<Dictionary<string, object>>();
            foreach (var rule in all)
            {
                string name = Common.S(rule, "name");
                var match = Regex.Match(name, @"^EasyTier (?<adapter>et_[a-zA-Z0-9_]+|ScreenSh-[a-f0-9]{16}) - (?<proto>TCP|UDP|ICMP|ALL) Protocol \((?<direction>Inbound|Outbound)\)$");
                if (!match.Success)
                    continue;
                string adapter = match.Groups["adapter"].Value;
                int protocol = new Dictionary<string, int> { { "TCP", 6 }, { "UDP", 17 }, { "ICMP", 1 }, { "ALL", 256 } }[match.Groups["proto"].Value], direction = match.Groups["direction"].Value == "Inbound" ? 1 : 2;
                var interfaces = ((IEnumerable)rule["interfaces"]).Cast<object>().ToArray();
                if ((legacy ? !adapter.StartsWith("et_") : adapter != iface) || Common.S(rule, "group") != "EasyTier" || Common.S(rule, "app") != "" || Common.N(rule, "action") != 1 || Common.N(rule, "protocol") != protocol || Common.N(rule, "direction") != direction || interfaces.Length != 1)
                    continue;
                string bound = Convert.ToString(interfaces[0]);
                if (bound != adapter && !Regex.IsMatch(bound, @"^\{[a-fA-F0-9-]{36}\}$"))
                    continue;
                if (present.Contains(adapter) || present.Contains(bound) || all.Count(r => Common.CI.Equals(Common.S(r, "name"), name)) != 1)
                    continue;
                selected.Add(Common.Obj("name", name, "adapter", adapter, "interface", bound));
            }
            return selected;
        }
        static Dictionary<string, object> Rule(dynamic r)
        {
            object interfaces = r.Interfaces;
            var list = new List<object>();
            if (interfaces is Array)
                foreach (object v in (Array)interfaces)
                    list.Add(v);
            return Common.Obj("name", (string)r.Name, "group", (string)r.Grouping, "app", (string)r.ApplicationName, "action", (int)r.Action, "protocol", (int)r.Protocol, "direction", (int)r.Direction, "interfaces", list.ToArray());
        }
        internal static object Firewall(string iface, string backupDirectory, bool apply)
        {
            if (!Regex.IsMatch(iface, @"^ScreenSh-[a-f0-9]{16}$"))
                throw new ArgumentException("Invalid ScreenSh interface name");
            dynamic policy = Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2"));
            var rules = new List<Dictionary<string, object>>();
            foreach (dynamic r in policy.Rules)
                if (((string)r.Name).StartsWith("EasyTier " + iface + " - "))
                    rules.Add(Rule(r));
            var selected = SelectFirewall(rules, Interfaces(), iface, false);
            int removed = 0;
            string backup = null;
            if (apply && selected.Count > 0)
            {
                if (!Path.IsPathRooted(backupDirectory))
                    throw new IOException("Backup directory required");
                Common.NoLinks(backupDirectory);
                Directory.CreateDirectory(backupDirectory);
                string stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N");
                backup = Path.Combine(backupDirectory, stamp + ".wfw");
                using (var export = Common.Start(Path.Combine(Environment.SystemDirectory, "netsh.exe"), "advfirewall export " + Common.Quote(backup), backupDirectory, true))
                {
                    if (!export.WaitForExit(20000))
                    {
                        export.Kill();
                        throw new IOException("Firewall backup timed out");
                    }
                    if (export.ExitCode != 0 || !File.Exists(backup) || new FileInfo(backup).Length == 0)
                        throw new IOException("Firewall backup failed; nothing removed");
                }
                Common.Write(Path.Combine(backupDirectory, stamp + ".json"), selected);
                var present = Interfaces();
                foreach (var entry in selected)
                {
                    if (present.Contains(Common.S(entry, "adapter")) || present.Contains(Common.S(entry, "interface")))
                        continue;
                    Dictionary<string, object> current = Rule(policy.Rules.Item(Common.S(entry, "name")));
                    if (SelectFirewall(new[] { current }, present, iface, false).Count == 1 && Convert.ToString(((object[])current["interfaces"])[0]) == Common.S(entry, "interface"))
                    {
                        policy.Rules.Remove(Common.S(entry, "name"));
                        removed++;
                    }
                }
            }
            return Common.Obj("candidates", selected.Count, "removed", removed, "backup", backup);
        }
    }
}
