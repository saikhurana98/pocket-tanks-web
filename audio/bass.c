/* 32-bit BASS calls used by Pocket Tanks. The browser owns the audio devices.
   Build with node tools/build-audio-driver.cjs (32-bit TinyCC) */
#include <windows.h>

typedef DWORD U;
typedef unsigned long long Q;
#define API __declspec(dllexport) __stdcall
static HANDLE bus = INVALID_HANDLE_VALUE;
static U nextId = 1, errorCode;
enum { LOAD=1, CHANNEL, PLAY, PAUSE, STOP, FREE, CONFIG, MASTER, RESET };
/* Each record is bounded by a size prefix. WriteFile can split a large record. */
static U send(U op,U a,U b,U c,const void *data,U size) {
    U header[5]={16+size,op,a,b,c}, written;
    if (bus==INVALID_HANDLE_VALUE) return 0;
    if (!WriteFile(bus,header,sizeof(header),&written,0)) return 0;
    return !size || WriteFile(bus,data,size,&written,0);
}
U API BASS_Init(int device,U freq,U flags,HWND win,void *guid) {
    if(bus==INVALID_HANDLE_VALUE) bus=CreateFileA("D:\\ptaudio.bus",GENERIC_WRITE,FILE_SHARE_READ,0,CREATE_ALWAYS,0,0);
    return bus!=INVALID_HANDLE_VALUE;
}
static U load(U kind,U mem,const void *file,Q offset,U length,U flags) {
    U id=nextId++;
    if (!file) return 0;
    if (!mem) {
        U attributes = (flags & 0x80000000u) ? GetFileAttributesW(file) : GetFileAttributesA(file);
        if (attributes == INVALID_FILE_ATTRIBUTES) { errorCode = 2; return 0; }
    }
    /* Bit 0 denotes memory. Bit 1 denotes a UTF-16 path. */
    U encoding=mem?1:(flags&0x80000000u)?2:0;
    U bytes=mem?length:encoding?2*lstrlenW(file):lstrlenA(file);
    if (!send(LOAD,id,kind,encoding,mem?(const char*)file+(U)offset:file,bytes)) return 0;
    if (flags&4) send(CONFIG,id,0xffffffff,1,0,0);
    return id;
}
U API BASS_MusicLoad(U mem,const void *file,Q offset,U len,U flags,U freq){return load(1,mem,file,offset,len,flags);}
U API BASS_StreamCreateFile(U mem,const void *file,Q offset,Q len,U flags){return load(2,mem,file,offset,(U)len,flags);}
U API BASS_SampleLoad(U mem,const void *file,Q offset,U len,U max,U flags){return load(0,mem,file,offset,len,flags);}
U API BASS_SampleGetChannel(U sample,U fresh){U id=nextId++;send(CHANNEL,id,sample,0,0,0);return id;}
U API BASS_ChannelPlay(U id,U restart){return send(PLAY,id,restart,0,0,0);}
U API BASS_ChannelPause(U id){return send(PAUSE,id,0,0,0,0);}
U API BASS_SampleStop(U id){return send(STOP,id,0,0,0,0);}
U API BASS_MusicFree(U id){return send(FREE,id,0,0,0,0);}
U API BASS_SampleFree(U id){return BASS_MusicFree(id);}
U API BASS_StreamFree(U id){return BASS_MusicFree(id);}
U API BASS_SetConfig(U option,U value){return send(CONFIG,0,option,value,0,0);}
U API BASS_Start(void){return send(MASTER,1,0,0,0,0);}
U API BASS_Pause(void){return send(MASTER,0,0,0,0,0);}
U API BASS_Stop(void){return send(MASTER,2,0,0,0,0);}
U API BASS_Free(void){send(RESET,0,0,0,0,0);if(bus!=INVALID_HANDLE_VALUE)CloseHandle(bus);bus=INVALID_HANDLE_VALUE;return 1;}
U API BASS_PluginLoad(const void *name,U flags){errorCode=2;return 0;}
U API BASS_ErrorGetCode(void){U e=errorCode;errorCode=0;return e;}
