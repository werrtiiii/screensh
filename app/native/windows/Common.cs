using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Management;
using System.Runtime.InteropServices;

namespace ScreenSh.Windows
{
    static class Common
    {
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8388608, RecursionLimit = 64 };
        internal static readonly StringComparer CI = StringComparer.OrdinalIgnoreCase;
        internal static string Self
        {
            get
            {
                return Process.GetCurrentProcess().MainModule.FileName;
            }
        }
        internal static Dictionary<string, object> Read(string file)
        {
            NoLinks(file);
            if (new FileInfo(file).Length > 8388608)
                throw new IOException("JSON file is too large");
            return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
        }
        internal static string S(Dictionary<string, object> value, string key)
        {
            object v;
            return value.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : "";
        }
        internal static long N(Dictionary<string, object> value, string key)
        {
            return Convert.ToInt64(value[key]);
        }
        internal static bool B(Dictionary<string, object> value, string key)
        {
            object v;
            return value.TryGetValue(key, out v) && Convert.ToBoolean(v);
        }
        internal static Dictionary<string, object> Obj(params object[] pairs)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i < pairs.Length; i += 2)
                d.Add((string)pairs[i], pairs[i + 1]);
            return d;
        }
        internal static void Write(string file, object value)
        {
            NoLinks(file);
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            var temp = file + ".tmp";
            NoLinks(temp);
            File.WriteAllText(temp, Json.Serialize(value), new UTF8Encoding(false));
            if (File.Exists(file))
                File.Replace(temp, file, null);
            else
                File.Move(temp, file);
        }
        internal static string Full(string file)
        {
            return Path.GetFullPath(file).TrimEnd(Path.DirectorySeparatorChar);
        }
        internal static bool Inside(string file, string root)
        {
            return Full(file).StartsWith(Full(root) + "\\", StringComparison.OrdinalIgnoreCase);
        }
        internal static void NoLinks(string file)
        {
            for (string p = Path.GetFullPath(file); !String.IsNullOrEmpty(p); p = Path.GetDirectoryName(p))
            {
                if ((File.Exists(p) || Directory.Exists(p)) && (File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Linked path is not allowed: " + p);
            }
        }
        internal static void Tree(string dir)
        {
            NoLinks(dir);
            if (Directory.Exists(dir))
                foreach (string child in Directory.EnumerateFileSystemEntries(dir))
                {
                    NoLinks(child);
                    if (Directory.Exists(child))
                        Tree(child);
                }
        }
        internal static void Remove(string file)
        {
            Tree(file);
            if (Directory.Exists(file))
                Directory.Delete(file, true);
            else if (File.Exists(file))
                File.Delete(file);
        }
        internal static void Move(string from, string to)
        {
            if (Directory.Exists(from))
                Directory.Move(from, to);
            else
                File.Move(from, to);
        }
        internal static string Hash(Stream stream, string algorithm, bool hex)
        {
            using (var hash = HashAlgorithm.Create(algorithm))
            {
                var bytes = hash.ComputeHash(stream);
                return hex ? BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant() : Convert.ToBase64String(bytes);
            }
        }
        internal static string Hash(string file, string algorithm, bool hex)
        {
            using (var stream = File.OpenRead(file))
                return Hash(stream, algorithm, hex);
        }
        internal static string Quote(string value)
        {
            if (value.IndexOf('\0') >= 0)
                throw new ArgumentException("Invalid argument");
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in value)
            {
                if (c == '\\')
                {
                    slashes++;
                    continue;
                }
                if (c == '\"')
                {
                    result.Append('\\', slashes * 2 + 1);
                    result.Append(c);
                }
                else
                {
                    result.Append('\\', slashes);
                    result.Append(c);
                }
                slashes = 0;
            }
            result.Append('\\', slashes * 2);
            result.Append('"');
            return result.ToString();
        }
        internal static Process Start(string exe, string arguments, string directory, bool hidden)
        {
            var info = new ProcessStartInfo(exe, arguments) { UseShellExecute = false, CreateNoWindow = hidden, WorkingDirectory = directory };
            return Process.Start(info);
        }
        internal static bool Alive(int pid)
        {
            try
            {
                return !Process.GetProcessById(pid).HasExited;
            }
            catch (ArgumentException) { return false; }
        }
        internal static void WaitParent(int pid, int milliseconds)
        {
            if (pid <= 0)
                return;
            try
            {
                using (var p = Process.GetProcessById(pid))
                {
                    if (!p.WaitForExit(milliseconds))
                        throw new IOException("Main application did not exit");
                }
            }
            catch (ArgumentException) { }
        }
        internal static List<Dictionary<string, object>> Processes()
        {
            var rows = new List<Dictionary<string, object>>();
            using (var search = new ManagementObjectSearcher("SELECT ProcessId,ParentProcessId,Name,ExecutablePath FROM Win32_Process"))
                foreach (ManagementObject p in search.Get())
                    using (p)
                        rows.Add(Obj("pid", Convert.ToInt32(p["ProcessId"]), "parent", Convert.ToInt32(p["ParentProcessId"]), "name", Convert.ToString(p["Name"]), "path", Convert.ToString(p["ExecutablePath"])));
            return rows;
        }
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr handle, int flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr handle, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
        internal static void StopChecked(int pid, string expected)
        {
            IntPtr h = OpenProcess(0x1000 | 0x100000 | 1, false, pid);
            if (h == IntPtr.Zero)
            {
                if (Alive(pid))
                    throw new IOException("Cannot inspect running process");
                return;
            }
            try
            {
                var name = new StringBuilder(32768);
                int size = name.Capacity;
                if (!QueryFullProcessImageName(h, 0, name, ref size) || !CI.Equals(Full(name.ToString()), Full(expected)))
                    throw new IOException("Process identity changed");
                if (!TerminateProcess(h, 1) && Alive(pid))
                    throw new IOException("Cannot stop owned process");
                if (WaitForSingleObject(h, 15000) != 0)
                    throw new IOException("Owned process did not finish exiting");
            }
            finally { CloseHandle(h); }
        }
        internal static void StopTree(int pid, string root)
        {
            var rows = Processes();
            var ids = new HashSet<int> { pid };
            bool added;
            do
            {
                added = false;
                foreach (var row in rows)
                    if (ids.Contains((int)row["parent"]) && ids.Add((int)row["pid"]))
                        added = true;
            } while (added);
            foreach (var row in rows.Where(r => ids.Contains((int)r["pid"])).Reverse())
            {
                string file = S(row, "path");
                if (!String.IsNullOrEmpty(file) && Inside(file, root))
                    StopChecked((int)row["pid"], file);
            }
            System.Threading.Thread.Sleep(300);
        }
        internal static int StopInstalled(string root, int installer, bool inspect)
        {
            root = Full(root);
            // Installation must not depend on WMI availability or its COM
            // permissions. Inspect native image paths; protected OS processes
            // cannot own files in this installation and are left untouched.
            var rows = new List<Dictionary<string, object>>();
            int self = Process.GetCurrentProcess().Id;
            foreach (var process in Process.GetProcesses())
            {
                using (process)
                {
                    int pid = process.Id;
                    if (pid == installer || pid == self) continue;
                    IntPtr handle = OpenProcess(0x1000, false, pid);
                    if (handle == IntPtr.Zero) continue;
                    try
                    {
                        var image = new StringBuilder(32768); int size = image.Capacity;
                        if (!QueryFullProcessImageName(handle, 0, image, ref size)) continue;
                        string file = image.ToString();
                        if (Inside(file, root) && !Inside(file, Path.Combine(root, "data")))
                            rows.Add(Obj("pid", pid, "path", file));
                    }
                    finally { CloseHandle(handle); }
                }
            }
            if (inspect)
            {
                Console.WriteLine(Json.Serialize(rows));
                return 0;
            }
            foreach (var row in rows)
            {
                try { StopChecked((int)row["pid"], S(row, "path")); }
                catch (Exception error) { throw new IOException("Cannot close installed process PID " + row["pid"] + " (" + S(row, "path") + "): " + error.Message, error); }
            }
            return 0;
        }
        internal static void PrepareUpgrade(string root, string replacement)
        {
            root = Full(root);
            NoLinks(root);
            string exe = Path.Combine(root, "ScreenSh.exe"), uninstaller = Path.Combine(root, "Uninstall ScreenSh.exe");
            if (!File.Exists(exe) || !File.Exists(uninstaller))
                return;
            if (FileVersionInfo.GetVersionInfo(exe).ProductName != "ScreenSh")
                throw new IOException("Not a ScreenSh installation");
            StopInstalled(root, Process.GetCurrentProcess().Id, false);
            NoLinks(uninstaller);
            string backup = Path.Combine(root, "data/temp", "legacy-uninstaller-" + Guid.NewGuid() + ".exe");
            NoLinks(backup);
            Directory.CreateDirectory(Path.GetDirectoryName(backup));
            File.Copy(uninstaller, backup);
            string platform = Path.Combine(root, "resources/screensh-platform.exe");
            NoLinks(platform);
            Directory.CreateDirectory(Path.GetDirectoryName(platform));
            File.Copy(Self, platform, true);
            File.Copy(replacement, uninstaller, true);
        }
    }
}
