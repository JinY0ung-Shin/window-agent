# Tools

## read_file
- description: 지정 경로의 파일 내용을 읽습니다
- tier: auto
- parameters:
  - path (string, required): 파일 경로

## write_file
- description: 지정 경로에 파일을 씁니다
- tier: confirm
- parameters:
  - path (string, required): 파일 경로
  - content (string, required): 파일 내용

## list_directory
- description: 디렉토리 내 파일 목록을 조회합니다
- tier: auto
- parameters:
  - path (string, required): 디렉토리 경로

## web_search
- description: URL의 웹 페이지 내용을 가져옵니다
- tier: confirm
- parameters:
  - url (string, required): 가져올 URL

## memory_note
- description: 에이전트의 메모리 노트를 관리합니다 (agent_id는 자동으로 설정됩니다)
- tier: auto
- parameters:
  - action (string, required): create | read | update | delete
  - id (string, optional): 노트 ID (update/delete 시 필요)
  - title (string, required): 노트 제목
  - content (string, optional): 노트 내용

## browser_navigate
- description: Navigate to a URL and return a snapshot of the page with interactive elements
- tier: confirm
- parameters:
  - url (string, required): The URL to navigate to

## browser_snapshot
- description: Take a snapshot of the current page showing all interactive elements
- tier: auto
- parameters:

## browser_click
- description: Click an interactive element on the page by its reference number
- tier: confirm
- parameters:
  - ref (number, required): The reference number of the element to click

## browser_type
- description: Type text into an input field by its reference number (cannot type into password fields)
- tier: confirm
- parameters:
  - ref (number, required): The reference number of the input field
  - text (string, required): The text to type

## browser_wait
- description: Wait for a specified number of seconds then take a new snapshot
- tier: auto
- parameters:
  - seconds (number, optional): Number of seconds to wait (default 2, max 10)

## browser_back
- description: Go back to the previous page in browser history
- tier: confirm
- parameters:

## browser_close
- description: Close the browser session for this conversation
- tier: confirm
- parameters:
