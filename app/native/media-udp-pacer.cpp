#define _WIN32_WINNT 0x0A00
#define FD_SETSIZE 128
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <mmsystem.h>
#include <chrono>
#include <deque>
#include <map>
#include <vector>
#include <iostream>
#include <cstdlib>
#include <algorithm>
#include <string>
#include <sstream>
struct PowerState{ULONG version,control,state;};
// Dynamically resolve this Windows 10+ API so the UDP helper can still start
// on older systems. All target PIDs come from Electron's own app metrics.
static int audioPolicy(int argc,char** argv){
  auto set=(BOOL(WINAPI*)(HANDLE,int,void*,DWORD))GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"SetProcessInformation");
  auto get=(BOOL(WINAPI*)(HANDLE,int,void*,DWORD))GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"GetProcessInformation");
  if(!set||!get||argc<4||argc>131)return 2;bool restore=std::string(argv[2])=="restore";if(!restore&&std::string(argv[2])!="apply")return 2;
  for(int i=3;i<argc;i++){
    std::string token=argv[i];std::replace(token.begin(),token.end(),':',' ');std::istringstream input(token);unsigned long pid=0,control=0,state=0;unsigned long long expected=0;input>>pid;
    if(!pid||input.fail()||(restore&&!(input>>expected>>control>>state)))return 2;
    HANDLE h=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_SET_INFORMATION,FALSE,pid);DWORD error=h?0:GetLastError();PowerState old{1,0,0};unsigned long long created=0;BOOL ok=FALSE;
    if(h){FILETIME born,exit,kernel,user;if(GetProcessTimes(h,&born,&exit,&kernel,&user)){created=((unsigned long long)born.dwHighDateTime<<32)|born.dwLowDateTime;
      if(restore){if(created==expected){PowerState original{1,control,state};ok=set(h,4,&original,sizeof(original));error=ok?0:GetLastError();}else error=ERROR_INVALID_PARAMETER;}
      else if(get(h,4,&old,sizeof(old))){PowerState realtime{1,0x1|0x4,0};ok=set(h,4,&realtime,sizeof(realtime));if(!ok&&GetLastError()==ERROR_INVALID_PARAMETER){realtime.control=0x1;ok=set(h,4,&realtime,sizeof(realtime));}error=ok?0:GetLastError();}
      else error=GetLastError();
    }else error=GetLastError();CloseHandle(h);}
    std::cout<<"{\"pid\":"<<pid<<",\"created\":\""<<created<<"\",\"control\":"<<old.control<<",\"state\":"<<old.state<<",\"applied\":"<<(ok?"true":"false")<<",\"error\":"<<error<<"}"<<std::endl;
  }return 0;
}
using Clock=std::chrono::steady_clock;
static sockaddr_in address(unsigned long ip,unsigned short port){sockaddr_in a{};a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(ip);a.sin_port=htons(port);return a;}
static SOCKET udp(const sockaddr_in& bindAddress){SOCKET s=socket(AF_INET,SOCK_DGRAM,0);if(s==INVALID_SOCKET)return s;int rx=2*1024*1024,tx=512*1024;u_long nonblocking=1;setsockopt(s,SOL_SOCKET,SO_RCVBUF,(char*)&rx,sizeof(rx));setsockopt(s,SOL_SOCKET,SO_SNDBUF,(char*)&tx,sizeof(tx));ioctlsocket(s,FIONBIO,&nonblocking);if(bind(s,(sockaddr*)&bindAddress,sizeof(bindAddress))!=0){closesocket(s);return INVALID_SOCKET;}return s;}
struct Flow{SOCKET back=INVALID_SOCKET;sockaddr_in client{};std::deque<std::vector<char>> queue;size_t queued=0;Clock::time_point next=Clock::now(),touched=Clock::now();};
int main(int argc,char** argv){
  if(argc>=2&&std::string(argv[1])=="--audio-policy")return audioPolicy(argc,argv);
  if(argc!=3)return 2;int port=std::atoi(argv[1]),targetPort=std::atoi(argv[2]);if(port<0||port>65535||targetPort<1024||targetPort>65535)return 2;
  WSADATA wsa{};if(WSAStartup(MAKEWORD(2,2),&wsa)!=0)return 3;
  if(timeBeginPeriod(1)!=TIMERR_NOERROR){WSACleanup();return 4;}
  SOCKET front=udp(address(0x7f000001,(unsigned short)port));if(front==INVALID_SOCKET){timeEndPeriod(1);WSACleanup();return 5;}
  sockaddr_in local{};int localSize=sizeof(local);getsockname(front,(sockaddr*)&local,&localSize);const auto target=address(0x7f000002,(unsigned short)targetPort);

  HANDLE tick=CreateWaitableTimerExW(nullptr,nullptr,0x2,TIMER_ALL_ACCESS);if(!tick)tick=CreateWaitableTimerW(nullptr,FALSE,nullptr);if(!tick){closesocket(front);timeEndPeriod(1);WSACleanup();return 6;}std::map<unsigned short,Flow> flows;unsigned long long sent=0,bytesSent=0,dropped=0,errors=0,peak=0;auto lastStats=Clock::now();char buffer[65536];
  std::cout<<"{\"type\":\"ready\",\"port\":"<<ntohs(local.sin_port)<<"}"<<std::endl;
  auto send=[&](const char* bytes,int count,const sockaddr_in& client){int n=sendto(front,bytes,count,0,(const sockaddr*)&client,sizeof(client));if(n<0){if(WSAGetLastError()!=WSAEWOULDBLOCK)errors++;return false;}sent++;bytesSent+=n;return true;};
  for(;;){
    fd_set reads;FD_ZERO(&reads);FD_SET(front,&reads);for(auto& pair:flows)FD_SET(pair.second.back,&reads);bool pending=false;for(auto& pair:flows)pending=pending||!pair.second.queue.empty();timeval wait{0,pending?0L:10000L};
    if(select(0,&reads,nullptr,nullptr,&wait)==SOCKET_ERROR)break;
    if(FD_ISSET(front,&reads))for(int batch=0;batch<256;batch++){
      sockaddr_in remote{};int size=sizeof(remote),n=recvfrom(front,buffer,sizeof(buffer),0,(sockaddr*)&remote,&size);if(n<0)break;if(remote.sin_addr.s_addr!=htonl(0x7f000001))continue;
      auto it=flows.find(remote.sin_port);if(it==flows.end()){if(flows.size()>=64)continue;Flow flow;flow.back=udp(address(0x7f000001,0));if(flow.back==INVALID_SOCKET){errors++;continue;}flow.client=remote;it=flows.emplace(remote.sin_port,std::move(flow)).first;}
      it->second.touched=Clock::now();if(sendto(it->second.back,buffer,n,0,(const sockaddr*)&target,sizeof(target))<0)errors++;
    }
    for(auto& pair:flows){auto& flow=pair.second;if(!FD_ISSET(flow.back,&reads))continue;for(int batch=0;batch<256;batch++){
      sockaddr_in remote{};int size=sizeof(remote),n=recvfrom(flow.back,buffer,sizeof(buffer),0,(sockaddr*)&remote,&size);if(n<0)break;
      if(remote.sin_addr.s_addr!=target.sin_addr.s_addr||remote.sin_port!=target.sin_port)continue;flow.touched=Clock::now();
      bool rtp=n>=12&&((unsigned char)buffer[0]&0xc0)==0x80&&!((unsigned char)buffer[1]>=192&&(unsigned char)buffer[1]<=223);
      if(!rtp){send(buffer,n,flow.client);continue;}if(flow.queued+n>2*1024*1024){dropped++;continue;}
      flow.queue.emplace_back(buffer,buffer+n);flow.queued+=n;peak=std::max(peak,(unsigned long long)flow.queued);
    }}
    auto now=Clock::now();for(auto it=flows.begin();it!=flows.end();){auto& flow=it->second;
      if(now-flow.touched>std::chrono::seconds(120)){closesocket(flow.back);it=flows.erase(it);continue;}
      if(now>=flow.next&&!flow.queue.empty()){size_t bytes=0;int count=0;while(!flow.queue.empty()){auto& packet=flow.queue.front();if(count&&(count>=1||bytes+packet.size()>1400))break;if(!send(packet.data(),(int)packet.size(),flow.client))break;bytes+=packet.size();count++;flow.queued-=packet.size();flow.queue.pop_front();}flow.next=now+std::chrono::microseconds(500);}
      ++it;
    }
    bool queued=false;auto due=Clock::now()+std::chrono::microseconds(500);for(auto& pair:flows)if(!pair.second.queue.empty()){queued=true;due=std::min(due,pair.second.next);}if(queued){auto us=std::max<long long>(50,std::chrono::duration_cast<std::chrono::microseconds>(due-Clock::now()).count());LARGE_INTEGER deadline;deadline.QuadPart=-us*10;SetWaitableTimer(tick,&deadline,0,nullptr,nullptr,FALSE);WaitForSingleObject(tick,10);}
    if(now-lastStats>std::chrono::seconds(2)){size_t queued=0;for(auto& pair:flows)queued+=pair.second.queued;std::cout<<"{\"type\":\"stats\",\"packets\":"<<sent<<",\"bytes\":"<<bytesSent<<",\"dropped\":"<<dropped<<",\"errors\":"<<errors<<",\"peakQueued\":"<<peak<<",\"queued\":"<<queued<<",\"flows\":"<<flows.size()<<"}"<<std::endl;lastStats=now;}
  }
  for(auto& pair:flows)closesocket(pair.second.back);closesocket(front);CloseHandle(tick);timeEndPeriod(1);WSACleanup();return 0;
}
