// Windows process-loopback capture. Selection comes from audio sessions, not
// visible windows. stdout is either JSON (--list) or 48 kHz stereo PCM16.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <atomic>
#include <cwctype>
#include <cstdio>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <stdexcept>
#ifndef AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
#define AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM 0x80000000
#endif

template<class T> struct Com {
  T* p = nullptr;
  ~Com() { if (p) p->Release(); }
  T** out() { return &p; }
  T* operator->() { return p; }
};
const GUID kEnumeratorClass = {0xbcde0395,0xe52f,0x467c,{0x8e,0x3d,0xc4,0x57,0x92,0x91,0x69,0x2e}};
const GUID kEnumerator = {0xa95664d2,0x9614,0x4f35,{0xa7,0x46,0xde,0x8d,0xb6,0x36,0x17,0xe6}};
const GUID kSessions = {0x77aa99a0,0x1bd6,0x484f,{0x8b,0xc7,0x2c,0x65,0x4c,0x9a,0x9b,0x6f}};
const GUID kSessionControl = {0xbfb7ff88,0x7239,0x4fc9,{0x8f,0xa2,0x07,0xc9,0x50,0xbe,0x9c,0x6d}};
const GUID kAudioClient = {0x1cb9ad4c,0xdbfa,0x4c32,{0xb1,0x78,0xc2,0xf5,0x68,0xa7,0x03,0xb2}};
const GUID kCaptureClient = {0xc8adbd64,0xe71e,0x48a0,{0xa4,0xde,0x18,0x5c,0x39,0x5c,0xd3,0x17}};
const GUID kCompletion = {0x41d949ab,0x9862,0x444a,{0x80,0xf6,0xc2,0x61,0x33,0x4d,0xa5,0xeb}};
struct AudioAsyncOperation : IUnknown { virtual HRESULT STDMETHODCALLTYPE GetActivateResult(HRESULT*, IUnknown**) = 0; };
struct AudioCompletion : IUnknown { virtual HRESULT STDMETHODCALLTYPE ActivateCompleted(AudioAsyncOperation*) = 0; };
void checked(HRESULT hr, const char* operation) {
  if (FAILED(hr)) { char text[180]; std::snprintf(text, sizeof(text), "%s (0x%08lX)", operation, static_cast<unsigned long>(hr)); throw std::runtime_error(text); }
}
std::string utf8(const std::wstring& value) {
  int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(size, '\0'); WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr); return result;
}
std::string json(const std::wstring& value) {
  std::string result = "\"";
  for (unsigned char c : utf8(value)) {
    if (c == '"' || c == '\\') { result += '\\'; result += c; }
    else if (c < 32) { char escaped[7]; std::snprintf(escaped, sizeof(escaped), "\\u%04x", c); result += escaped; }
    else result += c;
  }
  return result + '"';
}
void listSessions() {
  std::map<DWORD, std::pair<DWORD, std::wstring>> processes;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot != INVALID_HANDLE_VALUE) {
    PROCESSENTRY32W entry{}; entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot, &entry)) do { processes[entry.th32ProcessID] = {entry.th32ParentProcessID, entry.szExeFile}; } while (Process32NextW(snapshot, &entry));
    CloseHandle(snapshot);
  }
  Com<IMMDeviceEnumerator> enumerator; checked(CoCreateInstance(kEnumeratorClass, nullptr, CLSCTX_ALL, kEnumerator, reinterpret_cast<void**>(enumerator.out())), "Audio device enumeration failed");
  Com<IMMDeviceCollection> devices; checked(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, devices.out()), "Audio output enumeration failed");
  UINT count = 0; devices->GetCount(&count); std::set<DWORD> seen; std::string result = "[";
  for (UINT i = 0; i < count; i++) {
    Com<IMMDevice> device; if (FAILED(devices->Item(i, device.out()))) continue;
    Com<IAudioSessionManager2> manager; if (FAILED(device->Activate(kSessions, CLSCTX_ALL, nullptr, reinterpret_cast<void**>(manager.out())))) continue;
    Com<IAudioSessionEnumerator> sessions; if (FAILED(manager->GetSessionEnumerator(sessions.out()))) continue;
    int size = 0; sessions->GetCount(&size);
    for (int n = 0; n < size; n++) {
      Com<IAudioSessionControl> control; if (FAILED(sessions->GetSession(n, control.out()))) continue;
      Com<IAudioSessionControl2> session; if (FAILED(control->QueryInterface(kSessionControl, reinterpret_cast<void**>(session.out())))) continue;
      DWORD pid = 0; if (FAILED(session->GetProcessId(&pid)) || !pid || !processes.count(pid)) continue;
      // Capture the whole player's process tree, including changing audio children.
      for (int depth = 0; depth < 16; depth++) {
        DWORD parent = processes[pid].first;
        if (parent == pid || !processes.count(parent) || processes[parent].second != processes[pid].second) break;
        pid = parent;
      }
      if (seen.count(pid)) continue;
      AudioSessionState state; if (FAILED(control->GetState(&state)) || state == AudioSessionStateExpired) continue;
      seen.insert(pid); std::wstring name = processes[pid].second;
      DWORD parent = processes[pid].first;
      // Chromium-based players can emit audio from a child process. Include
      // its parent's executable in the label so provider shortcuts still match.
      for (int depth = 0; depth < 3 && processes.count(parent); depth++) {
        const auto& info = processes[parent];
        if (info.second != name && info.second != L"explorer.exe" && info.second != L"services.exe") { name = info.second + L" — " + name; break; }
        parent = info.first;
      }
      if (name.find(L"AMPLibraryAgent.exe") != std::wstring::npos) name = L"Apple Music (AMPLibraryAgent.exe)";
      if (result.size() > 1) result += ',';
      result += "{\"id\":\"process:" + std::to_string(pid) + "\",\"pid\":" + std::to_string(pid) + ",\"name\":" + json(name) + "}";
    }
  }
  // Players without an audio session yet must still be selectable before play.
  for (const auto& item : processes) {
    std::wstring executable = item.second.second;
    for (auto& character : executable) character = towlower(character);
    if (seen.count(item.first)) continue;
    if (executable != L"applemusic.exe" && executable != L"cloudmusic.exe" && executable != L"qqmusic.exe" && executable != L"kugou.exe") continue;
    DWORD parent = item.second.first;
    if (processes.count(parent) && processes[parent].second == item.second.second) continue;
    if (result.size() > 1) result += ',';
    std::wstring name = executable == L"applemusic.exe" ? L"Apple Music (AppleMusic.exe)" : item.second.second;
    result += "{\"id\":\"process:" + std::to_string(item.first) + "\",\"pid\":" + std::to_string(item.first) + ",\"name\":" + json(name) + "}";
  }
  result += ']'; std::fwrite(result.data(), 1, result.size(), stdout); std::fflush(stdout);
}
class Completion final : public AudioCompletion {
  std::atomic<ULONG> refs{1}; IUnknown* marshaler = nullptr;
public:
  HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_PENDING; IAudioClient* client = nullptr;
  Completion() { checked(CoCreateFreeThreadedMarshaler(this, &marshaler), "Audio callback initialization failed"); }
  ~Completion() { if (client) client->Release(); if (marshaler) marshaler->Release(); CloseHandle(event); }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** value) override {
    *value = nullptr;
    if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, kCompletion)) { *value = static_cast<AudioCompletion*>(this); AddRef(); return S_OK; }
    return marshaler ? marshaler->QueryInterface(iid, value) : E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
  ULONG STDMETHODCALLTYPE Release() override { ULONG value = --refs; if (!value) delete this; return value; }
  HRESULT STDMETHODCALLTYPE ActivateCompleted(AudioAsyncOperation* operation) override {
    Com<IUnknown> unknown; HRESULT activation;
    result = operation->GetActivateResult(&activation, unknown.out());
    if (SUCCEEDED(result)) result = activation;
    if (SUCCEEDED(result)) result = unknown->QueryInterface(kAudioClient, reinterpret_cast<void**>(&client));
    SetEvent(event); return S_OK;
  }
};
void captureProcess(DWORD pid) {
  HANDLE process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) throw std::runtime_error("The audio source process is unavailable");
  HMODULE module = LoadLibraryW(L"Mmdevapi.dll");
  using Activate = HRESULT(WINAPI*)(LPCWSTR, REFIID, PROPVARIANT*, AudioCompletion*, AudioAsyncOperation**);
  auto activate = reinterpret_cast<Activate>(GetProcAddress(module, "ActivateAudioInterfaceAsync"));
  if (!activate) throw std::runtime_error("Process audio capture is unavailable on this Windows version");
  struct Activation { DWORD type; DWORD process; DWORD mode; } params{1, pid, 0};
  PROPVARIANT properties{}; properties.vt = VT_BLOB; properties.blob.cbSize = sizeof(params); properties.blob.pBlobData = reinterpret_cast<BYTE*>(&params);
  Com<AudioAsyncOperation> operation; Com<AudioCompletion> handler; auto completed = new Completion(); handler.p = completed;
  checked(activate(L"VAD\\Process_Loopback", kAudioClient, &properties, completed, operation.out()), "Process audio activation failed");
  if (WaitForSingleObject(completed->event, 10000) != WAIT_OBJECT_0) throw std::runtime_error("Process audio activation timed out");
  checked(completed->result, "Process audio activation failed");
  WAVEFORMATEX format{}; format.wFormatTag = WAVE_FORMAT_PCM; format.nChannels = 2; format.nSamplesPerSec = 48000; format.wBitsPerSample = 16; format.nBlockAlign = 4; format.nAvgBytesPerSec = 192000;
  checked(completed->client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 0, 0, &format, nullptr), "Process audio initialization failed");
  Com<IAudioCaptureClient> capture; checked(completed->client->GetService(kCaptureClient, reinterpret_cast<void**>(capture.out())), "Audio capture initialization failed");
  HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  checked(completed->client->SetEventHandle(event), "Audio event initialization failed");
  checked(completed->client->Start(), "Audio capture start failed");
  std::fprintf(stderr, "READY\n"); std::fflush(stderr);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE); std::vector<BYTE> silence;
  for (;;) {
    if (WaitForSingleObject(process, 0) == WAIT_OBJECT_0) throw std::runtime_error("The audio source process has exited");
    if (WaitForSingleObject(event, 100) != WAIT_OBJECT_0) continue;
    UINT32 frames; checked(capture->GetNextPacketSize(&frames), "Audio packet query failed");
    while (frames) {
      BYTE* data; DWORD flags; checked(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr), "Audio packet read failed");
      DWORD bytes = frames * 4;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { silence.assign(bytes, 0); data = silence.data(); }
      DWORD written = 0; bool ok = WriteFile(output, data, bytes, &written, nullptr) != FALSE;
      capture->ReleaseBuffer(frames);
      if (!ok || written != bytes) { completed->client->Stop(); CloseHandle(event); CloseHandle(process); FreeLibrary(module); return; }
      checked(capture->GetNextPacketSize(&frames), "Audio packet query failed");
    }
  }
}
int main(int argc, char** argv) {
  try {
    checked(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "COM initialization failed");
    if (argc == 2 && std::string(argv[1]) == "--list") listSessions();
    else if (argc == 3 && std::string(argv[1]) == "--capture") captureProcess(static_cast<DWORD>(std::stoul(argv[2])));
    else throw std::runtime_error("Expected --list or --capture PID");
    CoUninitialize(); return 0;
  } catch (const std::exception& error) { std::fprintf(stderr, "%s\n", error.what()); return 1; }
}
