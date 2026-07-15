# Codex Usage Bar v1.2.1 배포본

GitHub 커넥터의 텍스트 파일 쓰기 경로에서도 원본 ZIP을 보존할 수 있도록 Base64 텍스트 조각으로 분할해 저장합니다. 각 파일을 이름순으로 결합한 뒤 Base64 디코딩하면 원본 ZIP이 복원됩니다.

## Windows PowerShell

```powershell
cd release
.\rebuild.ps1
```

## macOS·Linux

```sh
cd release
sh rebuild.sh
```

복원 결과:

- 파일명: `codex-usage-bar-v1.2.1.zip`
- SHA-256: `bdcdebcc6786642438cedb24f657d03ca3a9fdda38b041769231e8df18dceaca`
- 원본 크기: 34,149 bytes

두 스크립트는 ZIP을 만든 뒤 SHA-256을 자동으로 확인하며, 해시가 다르면 결과 파일을 삭제하고 실패 처리합니다.
