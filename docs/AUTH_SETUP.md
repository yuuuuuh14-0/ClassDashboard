# 로그인 개발과 Supabase 연결

현재 구현은 아이디·비밀번호 로그인, 서버에서 확인하는 세션, 로그아웃, 최초 비밀번호 변경, 로그인 후 계정 시작 화면을 제공한다. 학교·학급 배정과 진도 대시보드는 이후 개발 범위다.

## 1. 로컬 실행

Node.js 20.9 이상을 사용한다. 현재 개발 환경의 Node.js 20과 호환되도록 Supabase SDK와 SSR 패키지 버전을 고정했다.

```powershell
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열면 로그인 화면으로 이동한다. 로그인하지 않으면 `/dashboard`와 `/password`에 접근할 수 없다.

## 2. 연결 설정

`.env.example`을 참고해 프로젝트 루트의 `.env.local`에 다음을 설정한다. 이 파일은 Git에서 제외되며 비밀 키를 README나 채팅에 복사하지 않는다.

```dotenv
SUPABASE_URL=https://프로젝트주소.supabase.co
SUPABASE_ANON_KEY=공개키
SUPABASE_SECRET_KEY=서버전용secret키
APP_ORIGIN=http://localhost:3000
AUTH_LOGIN_DOMAIN=auth.classdashboard.invalid
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`는 기존 파일의 이름을 그대로 지원한다. 대신 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 사용하는 설정도 지원하지만, 두 종류를 동시에 넣으면 `SUPABASE_URL`, `SUPABASE_ANON_KEY`가 우선한다.

서버 전용 키는 Supabase 프로젝트의 Settings → API Keys에서 확인한다. `sb_secret_`으로 시작하는 secret 키를 `SUPABASE_SECRET_KEY`에 넣는다. 기존 `service_role` 키는 `SUPABASE_SERVICE_ROLE_KEY`라는 이름으로도 지원하며 두 값이 있으면 secret 키가 우선한다. 공개 키를 이 항목에 넣지 않는다. 서버 전용 키에 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. [Supabase API 키 안내](https://supabase.com/docs/guides/getting-started/api-keys)

`AUTH_LOGIN_DOMAIN`은 관리자 계정 발급 스크립트에서 내부 인증용 이메일 형식 식별자를 만들 때 사용한다. 생략하면 메일 발송용이 아닌 내부 식별자에 사용하는 `auth.classdashboard.invalid`를 기본값으로 쓰며 필요하면 서비스가 관리하는 도메인으로 바꿀 수 있다. 로그인 화면에서 이메일 입력을 요구하지 않으며, 계정 발급 시 이메일 확인 완료 상태로 생성하고 메일을 보내지 않는다. 일반 사용자의 복구는 관리자 초기화 방식으로 설계되어 있다.

설정을 변경한 뒤 개발 서버를 다시 시작한다. 운영 환경에서는 `APP_ORIGIN`을 실제 사이트의 HTTPS 주소로 바꾼다. POST 요청은 설정된 Origin과 일치해야 한다.

## 3. 인증 테이블 설치

Supabase 프로젝트의 SQL Editor에서 새 쿼리를 열고 [인증 마이그레이션](../supabase/migrations/202610070001_auth.sql) 내용을 전체 실행한다. 신규 인증 구조를 만드는 마이그레이션이므로 같은 파일을 반복 실행하지 않는다. 설치 실패 시 일부만 실행한 쿼리를 임의로 반복하기보다 결과와 기존 테이블을 먼저 확인한다.

이 마이그레이션은 사용자 프로필, 서버 전용 아이디 연결, 반복 시도 제한, 세션 종료 기록과 접근 정책을 생성한다. 공개 회원가입으로 만들어진 Auth 계정만으로는 업무 권한을 얻을 수 없다.

Supabase Authentication 설정에서는 다음을 확인한다.

- 이메일·비밀번호 인증이 활성화되어 있다.
- 공개 신규 회원가입은 비활성화한다. 계정은 관리자가 발급한다.
- Site URL은 사용하는 로컬 또는 운영 주소와 일치한다.

사용자 프로필은 본인의 활성 계정만 조회할 수 있고 브라우저에서 직접 생성·수정할 수 없다. 아이디 연결 테이블은 공개 데이터 API에 노출하지 않는다. 권한 값은 사용자가 바꿀 수 있는 Auth의 `user_metadata`에서 읽지 않는다.

## 4. 첫 계정 생성

이 작업은 연결된 Supabase에 실제 계정을 만든다. 임시 비밀번호를 명령 인수나 파일에 넣는 대신 PowerShell에서 숨김 입력으로 전달한다.

```powershell
$temporaryPassword = Read-Host '임시 비밀번호 12자 이상' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($temporaryPassword)
try {
  $env:BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  npm run auth:create-user -- site.admin "사이트 관리자" --site-admin
} finally {
  Remove-Item Env:\BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
```

일반 선생님 계정은 같은 방식으로 `npm run auth:create-user -- kim.teacher "김선생"`을 실행한다. 아이디는 사이트 전체에서 유일하며 영문·숫자·점·밑줄·하이픈 4~30자를 사용한다. 로그인할 때 앞뒤 공백과 영문 대소문자를 정규화한다. 비밀번호의 공백은 제거하지 않는다.

임시·새 비밀번호는 12자 이상이며 최대 72 UTF-8 바이트다. 한글처럼 여러 바이트를 쓰는 글자는 최대 글자 수가 줄어든다. 스크립트는 비밀번호와 인증 키를 출력하지 않는다. 최초 로그인 후 비밀번호를 바꿔야 시작 화면으로 이동한다.

Auth 계정 생성 후 아이디 등록이 실패하면 새로 만든 Auth 계정을 정리한다. 정리도 실패하면 해당 사용자 ID를 운영자가 확인하도록 안내한다. Auth 서비스와 프로필 생성이 하나의 DB 트랜잭션이라고 가정하지 않는다.

계정 발급·관리자 초기화의 웹 화면은 아직 구현하지 않았다. 현재 계정 발급은 이 운영자용 스크립트로 제공한다. 임시 비밀번호를 잊은 계정의 초기화 화면과 관리 절차는 학교 관리자 기능 구현 단계에서 추가한다.

## 5. 로그인과 세션 흐름

1. 로그인 서버가 아이디를 정규화하고 서버 전용 함수로 내부 인증 식별자를 조회한다.
2. 같은 아이디의 반복 시도를 DB에서 제한한다. 없는 아이디도 동일하게 처리한다.
3. Supabase Auth에 비밀번호 검증을 요청한다.
4. 본인의 활성 프로필을 조회한다. 비활성·프로필 미등록 계정은 로그인할 수 없다.
5. 최초 변경이 필요한 계정은 `/password`, 그 외에는 `/dashboard`로 이동한다.
6. 보호된 화면과 변경 요청마다 Auth 사용자와 DB 프로필을 다시 확인한다.

세션은 HttpOnly 쿠키를 사용한다. 토큰을 브라우저 저장소에 직접 보관하거나 클라이언트가 주장하는 사용자 정보만으로 인증하지 않는다. 세션 갱신은 서버 Proxy에서 처리한다. [Supabase 서버 인증 문서](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework), [Next.js 인증 가이드](https://nextjs.org/docs/app/guides/authentication)

로그아웃은 현재 세션의 ID를 DB에 차단한 뒤 쿠키 세션을 종료한다. 이전 쿠키를 다시 보내도 프로필 접근이 거부된다. 다른 기기의 세션을 모두 종료하는 별도 기능은 이번 범위에 포함하지 않는다. 비활성 계정과 최초 비밀번호 변경 제한은 후속 업무 테이블의 접근 정책에도 `can_access_app()`으로 적용해야 한다.

## 6. 검증 명령과 범위

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

단위 테스트는 아이디 정규화, 비밀번호의 UTF-8 길이, 새 비밀번호 검사, POST Origin 검사를 확인한다.

브라우저 테스트는 로컬 테스트 서버와 실제 Supabase SDK를 연결해 정상 로그인, 새로고침 유지, 로그아웃 후 쿠키 재사용 차단, 잘못된 비밀번호, 비활성 계정, 보호 화면, 최초 비밀번호 변경, 반복 시도 제한, 모바일 표시를 확인한다. 테스트용 HTTP 서버는 `tests/`에만 존재하고 운영 코드에서 사용하지 않는다. 기본 브라우저는 Windows에 설치된 Microsoft Edge다.

브라우저 테스트의 인증 서버는 HTTP 모의 서버다. 실제 Supabase Auth 서비스의 동작과 PostgreSQL의 접근 정책 검증을 대신하지 않는다. 실연결 검증은 마이그레이션을 설치한 프로젝트와 발급된 계정으로 별도 수행한다. 테스트는 환경 변수를 덮어써 실제 프로젝트의 사용자나 비밀번호를 변경하지 않는다.

실제 Supabase 연결 검증은 개발 서버와 인증 SQL이 준비된 뒤 명시적으로 실행한다.

```powershell
npm run auth:verify-live
```

이 명령은 `.env.local`에 연결된 프로젝트에 임시 계정 두 개를 생성한다. 임시 비밀번호와 세션은 메모리에서만 사용하며 출력하지 않는다. 실제 아이디 로그인, 최초 비밀번호 변경, 프로필 접근 제한, 계정 비활성화, 로그아웃·세션 종료를 검사한 뒤 생성한 계정과 관련 프로필·시도 기록을 정리한다. 기존 사용자 계정은 변경하지 않는다. 정리에 실패하면 처리할 임시 계정 ID를 안내한다.

기본 앱 주소는 `http://localhost:3000`이며 다른 주소는 `AUTH_TEST_APP_URL`로 지정한다. 화면과 API의 Origin 검사 기준인 `APP_ORIGIN`도 실제 접속 주소에 맞춰야 한다.

2026-10-07 실제 연결 프로젝트에서 계정 생성, 정상·실패 로그인, 최초 비밀번호 변경, 프로필 격리와 권한 변경 거부, 기존 세션의 비활성화 반영, 로그아웃 후 쿠키 재사용 차단을 검증했다. 검증용 계정은 종료 후 제거했다. 이 검증은 사용자에게 발급할 영구 계정을 생성하는 작업과 별개다.

## 7. 현재 제공하지 않는 기능

학교·학년·학급 배정, 학교 관리자 권한 관리 화면, 학생·단원 관리, 실제 진도 대시보드는 후속 단계다. 현재 선생님 시작 화면에는 담당 학급 배정 대기를 표시한다. 사이트 관리자 시작 화면은 본인 계정 정보를 확인할 수 있다.

DB 로그인 시도 제한은 동일 아이디 기준 15분에 실패를 포함한 최대 10회다. 성공하면 해당 아이디의 시도 기록을 초기화한다. 여러 존재하지 않는 아이디를 이용한 대량 시도까지 제한할 운영 환경의 IP별 요청 제한과 오래된 로그인 시도·세션 차단 기록의 정기 정리는 배포 구성 단계에서 추가한다.
