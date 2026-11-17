using System;
using System.IO;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace ScreenSh.Windows
{
    // A separate process owns the backup, including when NSIS is terminated.
    static class SetupUpdate
    {
        static FileStream Lock(string tx)
        {
            string file = Path.Combine(tx, "setup.lock"); Common.NoLinks(file);
            try { return new FileStream(file, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException error) { throw new IOException("Setup recovery is already running; wait for it to finish", error); }
        }
        static string Name(string name)
        {
            if (String.IsNullOrEmpty(name) || Path.GetFileName(name) != name || name == "." || name == ".." || Common.CI.Equals(name, "data"))
                throw new IOException("Invalid setup backup item");
            return name;
        }
        static IEnumerable<string> Entries(string root)
        {
            return Directory.GetFileSystemEntries(root).Where(p => !Common.CI.Equals(Path.GetFileName(p), "data")).ToArray();
        }
        static void Copy(string source, string target)
        {
            if (Directory.Exists(source))
            {
                Directory.CreateDirectory(target);
                foreach (string child in Directory.GetFileSystemEntries(source))
                    Copy(child, Path.Combine(target, Path.GetFileName(child)));
            }
            else File.Copy(source, target);
        }
        static object ReadRegistry(RegistryKey key)
        {
            if (key == null) return null;
            var values = new List<object>();
            foreach (string name in key.GetValueNames())
                values.Add(Common.Obj("name", name, "kind", (int)key.GetValueKind(name), "value", key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames)));
            var children = new Dictionary<string, object>();
            foreach (string name in key.GetSubKeyNames())
                using (var child = key.OpenSubKey(name)) children.Add(name, ReadRegistry(child));
            return Common.Obj("values", values, "children", children);
        }
        static void WriteRegistry(RegistryKey key, Dictionary<string, object> data)
        {
            foreach (var row in FileUpdate.Rows(data["values"]))
            {
                var kind = (RegistryValueKind)Common.N(row, "kind"); object value = row["value"];
                if (kind == RegistryValueKind.DWord) value = Convert.ToInt32(value);
                if (kind == RegistryValueKind.QWord) value = Convert.ToInt64(value);
                if (kind == RegistryValueKind.MultiString) value = ((IEnumerable)value).Cast<object>().Select(Convert.ToString).ToArray();
                if (kind == RegistryValueKind.Binary || kind == RegistryValueKind.None) value = ((IEnumerable)value).Cast<object>().Select(Convert.ToByte).ToArray();
                key.SetValue(Common.S(row, "name"), value, kind);
            }
            foreach (var child in (Dictionary<string, object>)data["children"])
                using (var subkey = key.CreateSubKey(child.Key)) WriteRegistry(subkey, (Dictionary<string, object>)child.Value);
        }
        internal static string Prepare(string root, string version, int pid, string helper, string installKey, string uninstallKey, string uninstaller)
        {
            root = Common.Full(root);
            if (root == Path.GetPathRoot(root).TrimEnd('\\')) throw new IOException("Invalid setup root");
            Common.NoLinks(root);
            string transactions = Path.Combine(root, "data/updates/transactions"); Common.NoLinks(transactions);
            Directory.CreateDirectory(transactions);
            foreach (string previous in Directory.GetDirectories(transactions))
            {
                string file = Path.Combine(previous, "journal.json");
                if (File.Exists(file) && new[] { "applying", "applied", "awaiting-startup", "rolling-back" }.Contains(Common.S(Common.Read(file), "phase")))
                    throw new IOException("An earlier update needs startup confirmation or recovery: " + Path.Combine(previous, "recover.exe"));
            }
            var roots = new HashSet<string>(Common.CI) { root };
            var registry = new List<object>();
            foreach (string hive in new[] { "HKLM", "HKCU" })
            {
                var owner = hive == "HKLM" ? Registry.LocalMachine : Registry.CurrentUser;
                using (var location = owner.OpenSubKey(installKey))
                using (var uninstall = owner.OpenSubKey(uninstallKey))
                {
                    string previous = Convert.ToString(location == null ? null : location.GetValue("InstallLocation"));
                    if (String.IsNullOrEmpty(previous))
                    {
                        string command = Convert.ToString(uninstall == null ? null : uninstall.GetValue("UninstallString"));
                        var match = Regex.Match(command, "^\\\"([^\\\"]+)\\\"|^(.+?\\.exe)(?: |$)", RegexOptions.IgnoreCase);
                        if (match.Success) previous = Path.GetDirectoryName(match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value);
                    }
                    if (!String.IsNullOrEmpty(previous)) roots.Add(Common.Full(previous));
                }
                foreach (string key in new[] { installKey, uninstallKey }.Distinct(Common.CI))
                    using (var entry = owner.OpenSubKey(key))
                        registry.Add(Common.Obj("hive", hive, "key", key, "data", ReadRegistry(entry)));
            }
            var installed = roots.Where(p => File.Exists(Path.Combine(p, "ScreenSh.exe"))).ToArray();
            if (installed.Length == 0) return "";
            foreach (string previous in installed)
            {
                if (previous == Path.GetPathRoot(previous).TrimEnd('\\') || FileVersionInfo.GetVersionInfo(Path.Combine(previous, "ScreenSh.exe")).ProductName != "ScreenSh") throw new IOException("Not a ScreenSh installation");
                if (roots.Any(other => !Common.CI.Equals(previous, other) && (Common.Inside(previous, other) || Common.Inside(other, previous)))) throw new IOException("Setup directories must not overlap");
                Common.NoLinks(previous); Common.StopInstalled(previous, pid, false);
            }
            string tx = Path.Combine(transactions, Guid.NewGuid().ToString()), backup = Path.Combine(tx, "backup");
            Directory.CreateDirectory(backup);
            // Copy before PrepareUpgrade replaces the old uninstaller and helper.
            for (int i = 0; i < installed.Length; i++)
            {
                string snapshot = Path.Combine(backup, i.ToString()); Directory.CreateDirectory(snapshot);
                foreach (string source in Entries(installed[i])) { Common.Tree(source); Copy(source, Path.Combine(snapshot, Name(Path.GetFileName(source)))); }
            }
            File.Copy(helper, Path.Combine(tx, "recover.exe"));
            Common.Write(Path.Combine(tx, "job.json"), Common.Obj("root", root, "exe", Path.Combine(root, "ScreenSh.exe"), "version", version, "parentPid", pid));
            Common.Write(Path.Combine(tx, "journal.json"), Common.Obj("kind", "setup", "root", root, "roots", installed, "version", version, "phase", "applying", "registry", registry));
            using (var guard = Common.Start(Path.Combine(tx, "recover.exe"), "--watch-setup " + Common.Quote(Path.Combine(tx, "job.json")), tx, true))
            {
                var deadline = DateTime.UtcNow.AddSeconds(15);
                while (!File.Exists(Path.Combine(tx, "ready")))
                {
                    if (guard.HasExited || DateTime.UtcNow > deadline) throw new IOException("Cannot start setup recovery guard; previous files have been retained: " + tx);
                    Thread.Sleep(50);
                }
            }
            foreach (string previous in installed) Common.PrepareUpgrade(previous, uninstaller);
            return tx;
        }
        internal static void Complete(string tx)
        {
            if (String.IsNullOrEmpty(tx)) return;
            var journal = Common.Read(Path.Combine(tx, "journal.json"));
            if (Common.S(journal, "kind") != "setup" || Common.S(journal, "phase") != "applying") throw new IOException("Invalid setup transaction");
            journal["phase"] = "applied"; Common.Write(Path.Combine(tx, "journal.json"), journal);
        }
        internal static void Restore(string tx, Dictionary<string, object> journal)
        {
            string backup = Path.Combine(tx, "backup"); Common.Tree(backup);
            var roots = ((IEnumerable)journal["roots"]).Cast<object>().Select(v => Common.Full(Convert.ToString(v))).ToArray();
            for (int i = 0; i < roots.Length; i++)
            {
                if (roots[i] == Path.GetPathRoot(roots[i]).TrimEnd('\\')) throw new IOException("Invalid setup recovery root");
                Common.NoLinks(roots[i]);
                if (!File.Exists(Path.Combine(backup, i.ToString(), "ScreenSh.exe"))) throw new IOException("Setup backup is incomplete");
            }
            Common.StopInstalled(Common.S(journal, "root"), Process.GetCurrentProcess().Id, false);
            foreach (string root in roots) Common.StopInstalled(root, Process.GetCurrentProcess().Id, false);
            journal["phase"] = "rolling-back"; Common.Write(Path.Combine(tx, "journal.json"), journal);
            // Keep the backup intact until every restored file and registry value is in place.
            for (int i = 0; i < roots.Length; i++)
            {
                foreach (string file in Entries(roots[i])) Common.Remove(file);
                foreach (string file in Entries(Path.Combine(backup, i.ToString()))) Copy(file, Path.Combine(roots[i], Name(Path.GetFileName(file))));
            }
            foreach (var row in FileUpdate.Rows(journal["registry"]))
            {
                var hive = Common.S(row, "hive") == "HKLM" ? Registry.LocalMachine : Registry.CurrentUser;
                string key = Common.S(row, "key");
                using (var existing = hive.OpenSubKey(key)) { if (existing == null && row["data"] == null) continue; }
                hive.DeleteSubKeyTree(key, false);
                if (row["data"] != null) using (var restored = hive.CreateSubKey(key)) WriteRegistry(restored, (Dictionary<string, object>)row["data"]);
            }
            journal["phase"] = "rolled-back"; Common.Write(Path.Combine(tx, "journal.json"), journal);
        }
        internal static void Recover(string tx)
        {
            using (Lock(tx))
            {
                var journal = Common.Read(Path.Combine(tx, "journal.json"));
                if (Common.S(journal, "kind") != "setup" || !new[] { "applying", "applied", "awaiting-startup", "rolling-back" }.Contains(Common.S(journal, "phase")))
                    throw new IOException("Setup transaction does not need recovery");
                Restore(tx, journal);
            }
        }
        internal static void Watch(string file)
        {
            var job = new UpdateJob(file); string tx = job.DirectoryName;
            using (Lock(tx))
            using (var installer = Process.GetProcessById((int)Common.N(job.Data, "parentPid")))
            {
                var journal = Common.Read(Path.Combine(tx, "journal.json"));
                if (Common.S(journal, "kind") != "setup") throw new IOException("Invalid setup guard job");
                var handle = installer.Handle; // Open the process before acknowledging; retain its exit code.
                File.WriteAllText(Path.Combine(tx, "ready"), "ready");
                installer.WaitForExit();
                journal = Common.Read(Path.Combine(tx, "journal.json"));
                if (installer.ExitCode == 0 && Common.S(journal, "phase") == "applied" && File.Exists(job.Exe))
                {
                    var version = FileVersionInfo.GetVersionInfo(job.Exe);
                    if (String.Format("{0}.{1}.{2}", version.ProductMajorPart, version.ProductMinorPart, version.ProductBuildPart) == job.Version)
                    {
                        // Only now can the renderer retire this backup. Before this
                        // state it sends a marker, as for portable transactions.
                        journal["phase"] = "awaiting-startup";
                        Common.Write(Path.Combine(tx, "journal.json"), journal);
                        string confirmed = Path.Combine(tx, "confirmed"); Common.NoLinks(confirmed);
                        if (File.Exists(confirmed) && File.ReadAllText(confirmed) == job.Version)
                        {
                            journal["phase"] = "confirmed";
                            // The renderer may confirm concurrently. Both transitions
                            // are final; separate temporary files keep them idempotent.
                            string receipt = Path.Combine(tx, "guard-confirm.json");
                            Common.Write(receipt, journal);
                            File.Replace(receipt, Path.Combine(tx, "journal.json"), null);
                            try { Common.Remove(Path.Combine(tx, "backup")); } catch { }
                        }
                        return;
                    }
                }
                Restore(tx, journal);
                job.Log("setup-rolled-back", installer.ExitCode);
            }
        }
    }
}
