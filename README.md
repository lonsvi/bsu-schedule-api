# BSU Schedule Proxy API 🎓

A lightweight, fast REST API proxy and parser for Baikal State University (BSU) student timetables.

## 🚀 Endpoints

### 1. Get Schedule by Group ID
```http
GET /api/schedule?idg={idg}
```
**Example:** `GET /api/schedule?idg=33344`

**Response:**
```json
{
  "groupId": "33344",
  "groupName": "ИИ-26-1",
  "semesterDates": "1 семестр 01.09.2026 - 08.12.2026",
  "currentWeekInfo": "1 неделя (нечетная)",
  "lastUpdatedMillis": 1788269000000,
  "lessons": [
    {
      "id": 1788269000001,
      "dayOfWeekIndex": 1,
      "dayName": "ПОНЕДЕЛЬНИК",
      "timeStart": "14:00",
      "timeEnd": "15:30",
      "parity": "EVEN",
      "lessonType": "практическое занятие",
      "subject": "Управление личной эффективностью",
      "auditorium": "3-403",
      "teacher": "Арбатская Елена Анатольевна"
    }
  ]
}
```

### 2. Get All Available Groups
```http
GET /api/groups
```

### 3. Health Check
```http
GET /
```

## 🛠 Features
- In-memory caching with 10-minute TTL to reduce load on university servers.
- Automatic parity detection (`ODD`, `EVEN`, `WEEKLY`).
- Clean JSON format for mobile and web clients.

## 📄 License
MIT
