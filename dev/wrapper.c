/* MAXIMUS — lanceur autonome.
   Embarque le jeu dans le binaire, le sert depuis la mémoire sur 127.0.0.1
   et ouvre une fenêtre applicative (Edge/Chrome --app, sans barre d'adresse).
   Aucun fichier n'est écrit sur le disque. */
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "game_html.h"

#ifdef _WIN32
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #include <windows.h>
  #include <shellapi.h>
  typedef int socklen_t_;
  #define CLOSESOCK closesocket
#else
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <unistd.h>
  #include <sys/select.h>
  #define SOCKET int
  #define INVALID_SOCKET (-1)
  #define CLOSESOCK close
  #define SD_SEND SHUT_WR
#endif

#define PORT_BASE 17323
#define PORT_MAX  17342

static void launch_browser(const char *url){
#ifdef _WIN32
  const char *cand[] = {
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  };
  char cmd[1024];
  for(int i=0;i<4;i++){
    if(GetFileAttributesA(cand[i]) != INVALID_FILE_ATTRIBUTES){
      snprintf(cmd, sizeof cmd, "\"%s\" --app=%s --window-size=1420,850", cand[i], url);
      STARTUPINFOA si; PROCESS_INFORMATION pi;
      ZeroMemory(&si, sizeof si); si.cb = sizeof si; ZeroMemory(&pi, sizeof pi);
      if(CreateProcessA(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)){
        CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
        return;
      }
    }
  }
  ShellExecuteA(NULL, "open", url, NULL, NULL, SW_SHOWNORMAL); /* navigateur par défaut */
#else
  (void)url; /* en test Linux on n'ouvre pas de navigateur */
#endif
}

static int serve(void){
  SOCKET ls = socket(AF_INET, SOCK_STREAM, 0);
  if(ls == INVALID_SOCKET) return 1;
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  int port = PORT_BASE, bound = 0;
  for(; port <= PORT_MAX; port++){
    a.sin_port = htons((unsigned short)port);
    if(bind(ls, (struct sockaddr*)&a, sizeof a) == 0){ bound = 1; break; }
  }
  char url[64];
  if(!bound){ /* déjà lancé ? on ouvre simplement la fenêtre sur l'instance existante */
    snprintf(url, sizeof url, "http://127.0.0.1:%d/", PORT_BASE);
    launch_browser(url);
    CLOSESOCK(ls);
    return 0;
  }
  listen(ls, 8);
  snprintf(url, sizeof url, "http://127.0.0.1:%d/", port);
  launch_browser(url);

  int bye = 0;
  time_t start = time(NULL);
  for(;;){
    fd_set fs; FD_ZERO(&fs); FD_SET(ls, &fs);
    struct timeval tv; tv.tv_sec = bye ? 3 : 60; tv.tv_usec = 0;
    int r = select((int)ls + 1, &fs, NULL, NULL, &tv);
    if(r <= 0){
      if(bye) break;                                /* fenêtre fermée, personne n'est revenu */
      if(time(NULL) - start > 6*3600) break;        /* garde-fou : 6 h max */
      continue;
    }
    SOCKET c = accept(ls, NULL, NULL);
    if(c == INVALID_SOCKET) continue;
    char buf[2048];
    int n = recv(c, buf, (int)sizeof buf - 1, 0);
    if(n > 0){
      buf[n] = 0;
      if(!strncmp(buf, "POST /bye", 9)){
        bye = 1;
        const char *ok = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
        send(c, ok, (int)strlen(ok), 0);
      } else if(!strncmp(buf, "GET / ", 6)){
        bye = 0;                                    /* rechargement : on reste en vie */
        char h[256];
        int hl = snprintf(h, sizeof h,
          "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
          "Content-Length: %u\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
          GAME_LEN);
        send(c, h, hl, 0);
        unsigned int off = 0;
        while(off < GAME_LEN){
          unsigned int chunk = GAME_LEN - off > 8192 ? 8192 : GAME_LEN - off;
          int s2 = send(c, (const char*)GAME + off, (int)chunk, 0);
          if(s2 <= 0) break;
          off += (unsigned int)s2;
        }
      } else {
        const char *nf = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        send(c, nf, (int)strlen(nf), 0);
      }
    }
    shutdown(c, SD_SEND);
    CLOSESOCK(c);
  }
  CLOSESOCK(ls);
  return 0;
}

#ifdef _WIN32
int WINAPI WinMain(HINSTANCE hI, HINSTANCE hP, LPSTR cmd, int show){
  (void)hI;(void)hP;(void)cmd;(void)show;
  WSADATA w;
  if(WSAStartup(MAKEWORD(2,2), &w) != 0) return 1;
  int r = serve();
  WSACleanup();
  return r;
}
#else
int main(void){ return serve(); }
#endif
