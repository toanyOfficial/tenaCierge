package main

import (
    "fmt"
    "github.com/toanyOfficial/schedule-manager/internal/day"
    "github.com/toanyOfficial/schedule-manager/internal/excel"
    "github.com/toanyOfficial/schedule-manager/internal/parser"
    "io"
    "log"
    "os"
    "runtime/debug"
)

func calculateTowels(nights int) uint {
    towels := nights * 2
    if towels < 4 {
        return 4
    } else if towels > 10 {
        return 10
    }
    return uint(towels)
}

func updateTowelCountsForEntries(entries parser.ProcessedList, processed parser.ProcessedList, today string, checkNextDay bool) {
    for i, entry := range entries {
        for _, originalEntry := range processed {
            if entry.Name == originalEntry.Name {
                for _, nextPlan := range originalEntry.Plans {
                    isNextDay, _ := day.CheckNextDay(today, nextPlan.DtStart)
                    if (checkNextDay && isNextDay) || (!checkNextDay && nextPlan.DtStart == today) {
                        nights, err := day.CalculateNights(nextPlan.DtStart, nextPlan.DtEnd)
                        if err == nil {
                            entries[i].Towel = calculateTowels(nights)
                        }
                        break
                    }
                }
            }
        }
    }
}

func updateTowelCounts(processed, todayData, tomorrowData parser.ProcessedList, today string) {
    updateTowelCountsForEntries(todayData, processed, today, false)
    updateTowelCountsForEntries(tomorrowData, processed, today, true)
}

// entries1에서 entries2 에 있는 데이터를 필터링 해서 걸려낸다.
func filterUniqueEntries(entries1, entries2 parser.ProcessedList) parser.ProcessedList {
    entryMap := make(map[string]bool)
    for _, entry := range entries2 {
        entryMap[entry.Name] = true
    }

    var uniqueEntries parser.ProcessedList
    for _, entry := range entries1 {
        if !entryMap[entry.Name] {
            uniqueEntries = append(uniqueEntries, entry)
        }
    }

    return uniqueEntries
}

// 플랫폼 별로 중복이 되는경우를 처리하는 로직
func mergePlansByPlatform(filtered parser.ProcessedList) parser.ProcessedList {
    // Entity
    indexMap := make(map[string][]parser.Processed)
    for _, p := range filtered {
        indexMap[p.Name] = append(indexMap[p.Name], p)
    }

    var result []parser.Processed
    for _, p := range indexMap {
        if len(p) > 1 { // 2개 이상인경우
            isOverBooking := false
            var resultProcessedList []parser.Processed

            for _, v := range p {
                if resultProcessedList != nil {
                    if resultProcessedList[0].Plans[0] != v.Plans[0] {
                        resultProcessedList = append(resultProcessedList, v)
                        isOverBooking = true
                    }
                } else {
                    resultProcessedList = append(resultProcessedList, v)
                }
            }

            if isOverBooking {
                for i := range resultProcessedList {
                    resultProcessedList[i].IsOverBooking = true
                }
            }

            result = append(result, resultProcessedList...)
        } else {
            result = append(result, p...)
        }
    }

    return result
}

func filterPlansByDate(processed parser.ProcessedList, date string) (parser.ProcessedList, parser.ProcessedList, parser.ProcessedList, parser.ProcessedList) {

    filterEntries := func(filterFunc func(parser.Plan) bool) parser.ProcessedList {
        var filtered parser.ProcessedList
        for _, p := range processed {
            filteredEntry := p.FilterPlans(filterFunc)
            if len(filteredEntry.Plans) > 0 {
                filtered = append(filtered, filteredEntry)
            }
        }

        return mergePlansByPlatform(filtered) // 날짜별로 필터링을 한 이후로 plan merge를 해야함
    }

    filterByTodayCheckIn := filterEntries(func(plan parser.Plan) bool { return plan.DtStart == date })
    filterByTomorrowCheckIn := filterEntries(func(plan parser.Plan) bool {
        isNextDay, err := day.CheckNextDay(date, plan.DtStart)
        return err == nil && isNextDay
    })
    filterByTodayCheckOut := filterEntries(func(plan parser.Plan) bool { return plan.DtEnd == date })
    filterByTomorrowCheckOut := filterEntries(func(plan parser.Plan) bool {
        isNextDay, err := day.CheckNextDay(date, plan.DtEnd)
        return err == nil && isNextDay
    })

    filteredByTodayCheckIn := filterUniqueEntries(filterByTodayCheckIn, filterByTodayCheckOut)
    filteredByTomorrowCheckIn := filterUniqueEntries(filterByTomorrowCheckIn, filterByTomorrowCheckOut)

    for i, e := range filteredByTodayCheckIn {
        nights, err := day.CalculateNights(e.Plans[0].DtStart, e.Plans[0].DtEnd)
        if err == nil {
            filteredByTodayCheckIn[i].Towel = calculateTowels(nights)
        }
    }

    for i, e := range filteredByTomorrowCheckIn {
        nights, err := day.CalculateNights(e.Plans[0].DtStart, e.Plans[0].DtEnd)
        if err == nil {
            filteredByTomorrowCheckIn[i].Towel = calculateTowels(nights)
        }
    }

    updateTowelCounts(processed, filterByTodayCheckOut, filterByTomorrowCheckOut, date)

    return filterByTodayCheckOut, filterByTomorrowCheckOut, filteredByTodayCheckIn, filteredByTomorrowCheckIn
}

func setLogFile() (*os.File, error) {
    logFile, err := os.OpenFile("application.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
    if err != nil {
        return nil, err
    }

    multiWriter := io.MultiWriter(logFile, os.Stdout)
    log.SetOutput(multiWriter)
    return logFile, nil
}

func main() {
    // 에러가 발생하는경우 로그 파일 만들기
    logFile, err := setLogFile()
    if err != nil {
        log.Fatalf("failed to initialize log : %v", err)
    }
    defer logFile.Close()

    defer func() {
        if err := recover(); err != nil {
            fmt.Println(fmt.Sprintf("Recovered. Error: %v \n %v", err, string(debug.Stack())))
            // log
            result := append([]byte(fmt.Sprintf("%v", err)), debug.Stack()...)
            log.Fatal(string(result))
        }
    }()
    log.Println("start make booking schedule")
    data, err := parser.LoadData()
    if err != nil {
        log.Fatalf("Failed to read data.toml: %v", err)
    }

    date, processed, butler, err := parser.ProcessData(data)
    if err != nil {
        log.Fatalf("Failed to process data: %v", err)
    }

    filteredByDate, filteredByNextDay, todayCheckRoom, tomorrowCheckRoom := filterPlansByDate(processed, date)

    excel.Generate(date, filteredByDate, filteredByNextDay, todayCheckRoom, tomorrowCheckRoom, butler)
    log.Println("end make booking schedule")
}
