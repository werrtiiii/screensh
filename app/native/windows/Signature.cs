using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
namespace ScreenSh.Windows
{
    static class Signature
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct FileInfo { public uint size; [MarshalAs(UnmanagedType.LPWStr)] public string file; public IntPtr handle, subject; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct TrustData { public uint size; public IntPtr policy, sip; public uint ui, revocation, choice; public IntPtr file; public uint action; public IntPtr state, url; public uint flags, context; public IntPtr settings; }
        [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true)]
        static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);
        internal static object Verify(string file)
        {
            Common.NoLinks(file);
            using (var locked = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                var info = new FileInfo { size = (uint)Marshal.SizeOf(typeof(FileInfo)), file = Path.GetFullPath(file) };
                IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(info));
                Marshal.StructureToPtr(info, pointer, false);
                var data = new TrustData { size = (uint)Marshal.SizeOf(typeof(TrustData)), ui = 2, choice = 1, file = pointer, action = 1, flags = 0x1000 };
                var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
                try
                {
                    int status = WinVerifyTrust(new IntPtr(-1), ref action, ref data);
                    if (status != 0) return Common.Obj("valid", false, "status", status);
                    using (var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(file)))
                        return Common.Obj("valid", true, "status", 0, "subject", certificate.Subject, "thumbprint", certificate.Thumbprint);
                }
                finally
                {
                    data.action = 2;
                    WinVerifyTrust(new IntPtr(-1), ref action, ref data);
                    Marshal.DestroyStructure(pointer, typeof(FileInfo));
                    Marshal.FreeHGlobal(pointer);
                }
            }
        }
    }
}
