using System;
using System.IO;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Drawing;

namespace ScreenSh.Windows
{
    sealed class UpdateJob
    {
        internal readonly string FileName, Root, Exe, Version, Installer, Checksum, DirectoryName;
        internal readonly Dictionary<string, object> Data;
        internal Action<string> OnState;
        internal UpdateJob(string file)
        {
            FileName = Path.GetFullPath(file);
            Common.NoLinks(file);
            Data = Common.Read(file);
            DirectoryName = Path.GetDirectoryName(FileName);
            Root = Common.Full(Common.S(Data, "root"));
            Exe = Common.Full(Common.S(Data, "exe"));
            Version = Common.S(Data, "version");
            Installer = Common.S(Data, "installer");
            Checksum = Common.S(Data, "sha512");
            if (Root == Path.GetPathRoot(Root).TrimEnd('\\') || !Common.CI.Equals(Exe, Path.Combine(Root, "ScreenSh.exe")) || !Regex.IsMatch(Version, @"^\d+\.\d+\.\d+$"))
                throw new IOException("Invalid update job");
            Common.NoLinks(Root);
        }
        internal void Log(string stage, object code)
        {
            try
            {
                string log = Path.Combine(Root, "data/logs/update-install.log");
                Common.NoLinks(log);
                System.IO.Directory.CreateDirectory(Path.GetDirectoryName(log));
                System.IO.File.AppendAllText(log, Common.Json.Serialize(Common.Obj("time", DateTime.UtcNow.ToString("o"), "version", Version, "stage", stage, "exitCode", code)) + Environment.NewLine);
            }
            catch { }
        }
        internal void State(string phase)
        {
            Common.Write(Path.Combine(DirectoryName, "portable-state.json"), Common.Obj("phase", phase));
            if (OnState != null)
                OnState(phase);
        }
        internal void Result(object value)
        {
            Common.Write(Path.Combine(DirectoryName, "portable-result.json"), value);
        }
    }
    sealed class FileUpdate
    {
        readonly UpdateJob job; string tx; Dictionary<string, object> journal; Process launched; bool canRollback;
        internal FileUpdate(UpdateJob value)
        {
            job = value;
        }
        internal static List<Dictionary<string, object>> Rows(object value)
        {
            return ((IEnumerable)value).Cast<object>().Select(v => (Dictionary<string, object>)v).ToList();
        }
        internal static string Relative(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length > 220 || value.StartsWith("/") || Regex.IsMatch(value, @"[\\:\x00-\x1f]"))
                throw new IOException("Unsafe update path");
            foreach (string part in value.Split('/'))
                if (part == "" || part == "." || part == ".." || Regex.IsMatch(part, @"[. ]$|^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)|[<>""|?*]"))
                    throw new IOException("Unsafe update path");
            string first = value.Split('/')[0];
            if (Common.CI.Equals(first, "data") || first.StartsWith("uninstall", StringComparison.OrdinalIgnoreCase) || Common.CI.Equals(first, "update-manifest.json"))
                throw new IOException("Protected update path");
            return value.Replace('/', '\\');
        }
        static bool Exists(string file)
        {
            return File.Exists(file) || Directory.Exists(file);
        }
        void Save()
        {
            Common.Write(Path.Combine(tx, "journal.json"), journal);
        }
        void RemoveTx(string name)
        {
            if (name != "new" && name != "backup")
                throw new IOException("Invalid transaction cleanup");
            Common.Remove(Path.Combine(tx, name));
        }
        void RemoveApp(string name)
        {
            if (Relative(name) != name || name.Contains("\\"))
                throw new IOException("Invalid application item");
            Common.Remove(Path.Combine(job.Root, name));
        }
        void Rollback()
        {
            job.State("rollback");
            journal["phase"] = "rolling-back";
            Save();
            if (launched != null)
                Common.StopTree(launched.Id, job.Root);
            foreach (var item in Rows(journal["items"]))
            {
                string name = Common.S(item, "name"), backup = Path.Combine(tx, "backup", name);
                if (Relative(name) != name || name.Contains("\\"))
                    throw new IOException("Invalid rollback item");
                if (Exists(backup))
                {
                    RemoveApp(name);
                    Common.Move(backup, Path.Combine(job.Root, name));
                }
                else if (!Common.B(item, "hadOld") && Common.B(item, "hasNew") && !Exists(Path.Combine(tx, "new", name)))
                    RemoveApp(name);
            }
            journal["phase"] = "rolled-back";
            Save();
            RemoveTx("new");
        }
        internal void Recover(string target)
        {
            tx = Common.Full(target);
            Guid guid;
            if (!Common.CI.Equals(Path.GetDirectoryName(tx), Common.Full(Path.Combine(job.Root, "data/updates/transactions"))) || !Guid.TryParseExact(Path.GetFileName(tx), "D", out guid))
                throw new IOException("Invalid recovery transaction");
            Common.Tree(tx);
            journal = Common.Read(Path.Combine(tx, "journal.json"));
            if (!Common.CI.Equals(Common.S(journal, "root"), job.Root) || !new[] { "applying", "applied", "rolling-back" }.Contains(Common.S(journal, "phase")))
                throw new IOException("Transaction does not need recovery");
            foreach (var item in Rows(journal["items"]))
                if (Relative(Common.S(item, "name")) != Common.S(item, "name") || Common.S(item, "name").Contains("\\"))
                    throw new IOException("Invalid recovery item");
            if (Common.Processes().Any(p => !String.IsNullOrEmpty(Common.S(p, "path")) && Common.Inside(Common.S(p, "path"), job.Root) && !Common.Inside(Common.S(p, "path"), Path.Combine(job.Root, "data"))))
                throw new IOException("Close ScreenSh before recovery");
            Rollback();
            job.Result(Common.Obj("success", true, "restored", true));
        }
        static void CopyLimited(Stream input, string target, long size)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using (var output = File.Create(target))
            {
                var buffer = new byte[65536];
                long total = 0;
                int length;
                while ((length = input.Read(buffer, 0, buffer.Length)) != 0)
                {
                    total += length;
                    if (total > size)
                        throw new IOException("Oversized update file");
                    output.Write(buffer, 0, length);
                }
                if (total != size)
                    throw new IOException("Truncated update file");
            }
        }
        internal void Apply()
        {
            try
            {
                ApplyFiles();
                job.Result(Common.Obj("success", true, "version", job.Version));
            }
            catch (Exception e) { bool restored = false; string message = e.Message; if (canRollback && journal != null && Common.S(journal, "phase") != "confirmed") try { Rollback(); restored = true; } catch (Exception rollback) { message += "; rollback failed: " + rollback.Message; } else if (journal == null && tx != null) try { RemoveTx("new"); } catch { } job.Result(Common.Obj("success", false, "restored", restored, "message", message, "transaction", tx)); throw new IOException(restored ? "更新未完成，已恢复旧版本。 " + message : message, e); }
        }
        void ApplyFiles()
        {
            string archive = Path.GetFullPath(job.Installer), pending = Common.Full(Path.Combine(job.Root, "data/updates/pending"));
            bool incremental = archive.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
            if (!Common.CI.Equals(Path.GetDirectoryName(archive), pending) || Path.GetFileName(archive) != "ScreenSh-" + job.Version + (incremental ? "-Update.json" : "-Update.zip"))
                throw new IOException("Invalid update package");
            foreach (string part in new[] { "data", "data/updates", "data/updates/pending", "data/updates/incremental", "data/updates/transactions" })
                Common.NoLinks(Path.Combine(job.Root, part));
            Common.NoLinks(archive);
            using (var input = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (Common.Hash(input, "SHA512", false) != job.Checksum)
                    throw new IOException("Update package checksum mismatch");
                input.Position = 0;
                job.State("extracting");
                string transactions = Path.Combine(job.Root, "data/updates/transactions");
                Directory.CreateDirectory(transactions);
                foreach (string previous in Directory.GetDirectories(transactions))
                {
                    string file = Path.Combine(previous, "journal.json");
                    Common.NoLinks(file);
                    if (File.Exists(file) && new[] { "applying", "applied", "rolling-back" }.Contains(Common.S(Common.Read(file), "phase")))
                    {
                        // Upgrade the recovery entry point of legacy transactions
                        // without executing or deleting their old scripts/backups.
                        Common.Tree(previous);
                        var oldJob = new UpdateJob(Path.Combine(previous, "job.json"));
                        Guid id;
                        if (!Guid.TryParseExact(Path.GetFileName(previous), "D", out id) || !Common.CI.Equals(oldJob.Root, job.Root))
                            throw new IOException("Invalid interrupted transaction");
                        string recovery = Path.Combine(previous, "recover.exe");
                        if (!File.Exists(recovery))
                            File.Copy(Common.Self, recovery);
                        throw new IOException("Interrupted update needs recovery: " + recovery);
                    }
                }
                tx = Path.Combine(transactions, Guid.NewGuid().ToString());
                string fresh = Path.Combine(tx, "new"), backup = Path.Combine(tx, "backup");
                Directory.CreateDirectory(fresh);
                Directory.CreateDirectory(backup);
                File.Copy(Common.Self, Path.Combine(tx, "recover.exe"));
                File.Copy(job.FileName, Path.Combine(tx, "job.json"));
                Dictionary<string, object> manifest;
                ZipArchive zip = null;
                string stage = null;
                try
                {
                    if (incremental)
                    {
                        if (input.Length > 8388608)
                            throw new IOException("Manifest too large");
                        string hash = Common.Hash(input, "SHA256", true);
                        input.Position = 0;
                        using (var reader = new StreamReader(input, System.Text.Encoding.UTF8, true, 4096, true))
                            manifest = Common.Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                        stage = Path.Combine(job.Root, "data/updates/incremental", job.Version + "-" + hash);
                        Common.Tree(stage);
                    }
                    else
                    {
                        zip = new ZipArchive(input, ZipArchiveMode.Read, true);
                        if (zip.Entries.Count > 30000)
                            throw new IOException("Too many update files");
                        var entry = zip.GetEntry("update-manifest.json");
                        if (entry == null || entry.Length > 8388608)
                            throw new IOException("Missing update manifest");
                        using (var reader = new StreamReader(entry.Open()))
                            manifest = Common.Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                    }
                    if (Common.N(manifest, "schemaVersion") != (incremental ? 2 : 1) || Common.S(manifest, "version") != job.Version)
                        throw new IOException("Invalid update manifest");
                    var rows = Rows(manifest["files"]);
                    if (rows.Count == 0 || rows.Count > 30000)
                        throw new IOException("Invalid update file count");
                    var files = new Dictionary<string, Dictionary<string, object>>(Common.CI);
                    long total = 0;
                    foreach (var file in rows)
                    {
                        string relative = Relative(Common.S(file, "path"));
                        object size = file["size"];
                        if (!(size is int || size is long) || Common.N(file, "size") < 0 || Common.N(file, "size") > 2147483648 || !Regex.IsMatch(Common.S(file, "sha256"), @"^[a-f0-9]{64}$") || files.ContainsKey(relative))
                            throw new IOException("Invalid manifest file");
                        files.Add(relative, file);
                        total = checked(total + Common.N(file, "size"));
                    }
                    if (!files.ContainsKey("ScreenSh.exe") || !files.ContainsKey("resources\\app.asar") || total > 8589934592)
                        throw new IOException("Incomplete update payload");
                    if (new DriveInfo(Path.GetPathRoot(job.Root)).AvailableFreeSpace < total + 104857600)
                        throw new IOException("Insufficient disk space");
                    if (incremental)
                    {
                        foreach (var pair in files)
                        {
                            string source = Path.Combine(stage, pair.Key + ".payload");
                            if (!File.Exists(source))
                                source = Path.Combine(job.Root, pair.Key);
                            Common.NoLinks(source);
                            if (new FileInfo(source).Length != Common.N(pair.Value, "size") || Common.Hash(source, "SHA256", true) != Common.S(pair.Value, "sha256"))
                                throw new IOException("Incremental input changed; download update again");
                            string destination = Path.Combine(fresh, pair.Key);
                            Directory.CreateDirectory(Path.GetDirectoryName(destination));
                            File.Copy(source, destination);
                            if (Common.Hash(destination, "SHA256", true) != Common.S(pair.Value, "sha256"))
                                throw new IOException("Copied file checksum mismatch");
                        }
                    }
                    else
                    {
                        var seen = new HashSet<string>(Common.CI);
                        foreach (var entry in zip.Entries)
                        {
                            if (entry.FullName == "update-manifest.json")
                            {
                                if (!seen.Add("manifest"))
                                    throw new IOException("Duplicate manifest");
                                continue;
                            }
                            string relative = Relative(entry.FullName);
                            Dictionary<string, object> file;
                            if (!seen.Add(relative) || !files.TryGetValue(relative, out file) || entry.Length != Common.N(file, "size") || ((entry.ExternalAttributes >> 16) & 61440) == 40960 || (entry.ExternalAttributes & 1024) != 0)
                                throw new IOException("Unsafe ZIP entry");
                            string destination = Path.Combine(fresh, relative);
                            using (var stream = entry.Open())
                                CopyLimited(stream, destination, entry.Length);
                            if (Common.Hash(destination, "SHA256", true) != Common.S(file, "sha256"))
                                throw new IOException("Extracted file checksum mismatch");
                        }
                        if (seen.Count != files.Count + 1)
                            throw new IOException("Missing update files");
                    }
                    // Extraction is complete. Release the download before the
                    // new renderer confirms startup and cleans its update cache.
                    if (zip != null) { zip.Dispose(); zip = null; }
                    input.Dispose();
                    job.State("replacing");
                    var names = new HashSet<string>(files.Keys.Select(file => file.Split('\\')[0]), Common.CI);
                    var managed = new HashSet<string>(new[] { "resources", "locales", "ScreenSh.exe", "chrome_100_percent.pak", "chrome_200_percent.pak", "d3dcompiler_47.dll", "ffmpeg.dll", "icudtl.dat", "libEGL.dll", "libGLESv2.dll", "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin", "vk_swiftshader.dll", "vk_swiftshader_icd.json", "vulkan-1.dll", "LICENSE.electron.txt", "LICENSES.chromium.html" }, Common.CI);
                    string inventory = Path.Combine(job.Root, "data/updates/installed-files.json");
                    Common.NoLinks(inventory);
                    if (File.Exists(inventory))
                        foreach (object name in (IEnumerable)Common.Read(inventory)["roots"])
                        {
                            string safe = Relative(Convert.ToString(name));
                            if (safe.Contains("\\"))
                                throw new IOException("Invalid inventory");
                            managed.Add(safe);
                        }
                    managed.UnionWith(names);
                    var items = new List<object>();
                    foreach (string name in managed.OrderBy(s => s, Common.CI))
                    {
                        if (Relative(name) != name || name.Contains("\\"))
                            throw new IOException("Invalid managed root");
                        Common.Tree(Path.Combine(job.Root, name));
                        items.Add(Common.Obj("name", name, "hadOld", Exists(Path.Combine(job.Root, name)), "hasNew", names.Contains(name)));
                    }
                    journal = Common.Obj("root", job.Root, "version", job.Version, "phase", "applying", "items", items);
                    Save();
                    canRollback = true;
                    foreach (var item in Rows(journal["items"]))
                    {
                        string name = Common.S(item, "name");
                        if (Common.B(item, "hadOld"))
                            Common.Move(Path.Combine(job.Root, name), Path.Combine(backup, name));
                        if (Common.B(item, "hasNew"))
                            Common.Move(Path.Combine(fresh, name), Path.Combine(job.Root, name));
                    }
                    journal["phase"] = "applied";
                    Save();
                    job.State("starting");
                    launched = Common.Start(job.Exe, "--portable-updated", job.Root, false);
                    string confirmed = Path.Combine(tx, "confirmed");
                    var deadline = DateTime.UtcNow.AddSeconds(60);
                    while (!File.Exists(confirmed))
                    {
                        if (launched.HasExited)
                            throw new IOException("New application exited before startup confirmation");
                        if (DateTime.UtcNow > deadline)
                            throw new IOException("New application startup confirmation timed out");
                        Thread.Sleep(250);
                    }
                    Common.NoLinks(confirmed);
                    if (File.ReadAllText(confirmed) != job.Version)
                        throw new IOException("Invalid startup confirmation");
                    journal["phase"] = "confirmed";
                    Save();
                    Common.Write(inventory, Common.Obj("version", job.Version, "roots", names.ToArray()));
                    try
                    {
                        RemoveTx("backup");
                        RemoveTx("new");
                    }
                    catch { }
                }
                finally { if (zip != null) zip.Dispose(); }
            }
        }
    }
    static class Updater
    {
        internal static void Setup(UpdateJob job)
        {
            string pending = Common.Full(Path.Combine(job.Root, "data/updates/pending")), archive = Path.GetFullPath(job.Installer);
            if (!Common.CI.Equals(Path.GetDirectoryName(archive), pending) || Path.GetFileName(archive) != "ScreenSh-" + job.Version + "-Setup.exe")
                throw new IOException("Invalid installer path");
            Common.NoLinks(archive);
            if (Common.Hash(archive, "SHA512", false) != job.Checksum)
                throw new IOException("Installer checksum mismatch");
            string stage = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temp", "ScreenSh-install-" + Guid.NewGuid());
            Common.NoLinks(stage);
            Directory.CreateDirectory(stage);
            try
            {
                string exe = Path.Combine(stage, "setup.exe");
                File.Copy(archive, exe);
                if (Common.Hash(exe, "SHA512", false) != job.Checksum)
                    throw new IOException("Installer copy checksum mismatch");
                var info = new ProcessStartInfo(exe, "/S --updated --screensh-staged /D=" + job.Root) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = stage };
                info.EnvironmentVariables["TEMP"] = stage;
                info.EnvironmentVariables["TMP"] = stage;
                using (var process = Process.Start(info))
                {
                    job.Log("installer-started", null);
                    process.WaitForExit();
                    job.Log("installer-exited", process.ExitCode);
                    if (process.ExitCode != 0)
                        throw new IOException("Installer returned " + process.ExitCode);
                }
                var version = FileVersionInfo.GetVersionInfo(job.Exe);
                if (String.Format("{0}.{1}.{2}", version.ProductMajorPart, version.ProductMinorPart, version.ProductBuildPart) != job.Version)
                    throw new IOException("Installed version does not match");
                job.Log("installed", 0);
                Common.Start(job.Exe, "--update-recovery", job.Root, false);
            }
            finally { try { Common.Remove(stage); } catch { } }
        }
        internal static int Window(string jobFile, string recover)
        {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            Application.EnableVisualStyles();
            var job = new UpdateJob(jobFile);
            var form = new Form { Text = "ScreenSh 更新", ClientSize = new Size(500, 300), StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, Font = new Font("Microsoft YaHei UI", 10) };
            bool dark = Common.S(job.Data, "theme") == "dark", busy = true;
            form.BackColor = ColorTranslator.FromHtml(dark ? "#2b2b2b" : "#fbfbfb");
            form.ForeColor = dark ? Color.White : Color.FromArgb(36, 36, 36);
            var brand = new Label { Text = "ScreenSh", Location = new Point(30, 22), AutoSize = true, ForeColor = Color.FromArgb(71, 158, 245) };
            var heading = new Label { Text = "正在应用更新", Location = new Point(28, 62), Size = new Size(445, 38), Font = new Font(form.Font.FontFamily, 17) };
            var detail = new Label { Text = "正在等待主程序安全退出…", Location = new Point(30, 113), Size = new Size(440, 65) };
            var bar = new ProgressBar { Location = new Point(30, 190), Size = new Size(440, 6), Style = ProgressBarStyle.Marquee };
            var retry = new Button { Text = "重试更新", Location = new Point(358, 230), Size = new Size(110, 34), Visible = false, BackColor = Color.FromArgb(15, 108, 189), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            var open = new Button { Text = "打开当前版本", Location = new Point(218, 230), Size = new Size(130, 34), Visible = false };
            form.Controls.AddRange(new Control[] { brand, heading, detail, bar, retry, open });
            Action<string> report = message => { if (!form.IsDisposed) form.BeginInvoke((Action)(() => detail.Text = message)); };
            job.OnState = phase => report(phase == "extracting" ? "正在校验更新文件…" : phase == "replacing" ? "正在备份并替换程序文件…" : phase == "starting" ? "正在启动新版并确认运行状态…" : phase == "rollback" ? "更新未完成，正在恢复旧版本…" : phase);
            Action run = null;
            run = () => { busy = true; retry.Visible = false; open.Visible = false; bar.Visible = true; Task.Run(() => { try { if (recover != null) { new FileUpdate(job).Recover(recover); report("已恢复旧版本"); } else { int parent = job.Data.ContainsKey("parentPid") ? (int)Common.N(job.Data, "parentPid") : 0; Common.WaitParent(parent, 90000); report("正在校验、备份并替换程序文件…"); if (job.Installer.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) Setup(job); else { new FileUpdate(job).Apply(); job.Log("portable-confirmed", 0); } } form.BeginInvoke((Action)(() => { busy = false; form.Close(); })); } catch (Exception e) { job.Log("failed", e.Message); form.BeginInvoke((Action)(() => { busy = false; heading.Text = "更新未完成"; detail.Text = e.Message; bar.Visible = false; retry.Visible = true; open.Visible = File.Exists(job.Exe); })); } }); };
            retry.Click += (s, e) => run();
            open.Click += (s, e) => { try { Common.Start(job.Exe, "--update-recovery", job.Root, false); form.Close(); } catch (Exception error) { detail.Text = error.Message; } };
            form.FormClosing += (s, e) => { if (busy) e.Cancel = true; };
            form.Shown += (s, e) => { string ready = Common.S(job.Data, "ready"); if (ready != "") { Common.NoLinks(ready); File.WriteAllText(ready, "ready"); } run(); };
            Application.Run(form);
            return 0;
        }
        internal static int Bootstrap(string stage, string root, int pid, bool silent, bool updated, bool force)
        {
            stage = Common.Full(stage);
            string temp = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temp");
            if (!Common.CI.Equals(Path.GetDirectoryName(stage), temp) || !Regex.IsMatch(Path.GetFileName(stage), @"^ScreenSh-bootstrap-\d+\.tmp$"))
                throw new IOException("Invalid bootstrap directory");
            Common.Tree(stage);
            Common.WaitParent(pid, 60000);
            var info = new ProcessStartInfo(Path.Combine(stage, "setup.exe"), "--screensh-staged" + (silent ? " /S" : "") + (updated ? " --updated" : "") + (force ? " --force-run" : "") + " /D=" + root) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = stage };
            info.EnvironmentVariables["TEMP"] = temp;
            info.EnvironmentVariables["TMP"] = temp;
            try
            {
                using (var process = Process.Start(info))
                {
                    process.WaitForExit();
                    Common.Write(Path.Combine(stage, "bootstrap-result.json"), Common.Obj("exitCode", process.ExitCode, "root", root));
                    return process.ExitCode;
                }
            }
            finally { try { File.Delete(Path.Combine(stage, "setup.exe")); } catch { } }
        }
    }
}
