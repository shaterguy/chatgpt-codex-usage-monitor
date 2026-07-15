# Codex Usage Bar v1.2.0 배포본

GitHub 커넥터의 바이너리 업로드 제한 때문에 원본 ZIP을 Base64 텍스트 5개로 분할해 저장했습니다. 각 파일은 이름순으로 결합한 뒤 Base64 디코딩하면 원본 ZIP이 복원됩니다.

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

- 파일명: `codex-usage-bar-v1.2.0.zip`
- SHA-256: `f4a4cd170999c26c45bd8bd2e8d67d779af676bfee165a0959c4d790f3d85000`
- 원본 크기: 32,553 bytes

두 스크립트는 ZIP을 만든 뒤 SHA-256을 자동으로 확인하며, 해시가 다르면 결과 파일을 삭제하고 실패 처리합니다.
