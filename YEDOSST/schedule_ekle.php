<?php
$conn = new mysqli("localhost", "root", "", "veriler");
if ($conn->connect_error) {
    die("Bağlantı hatası: " . $conn->connect_error);
}

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $valve_id = intval($_POST['valve_id']);
    $day_of_week = $conn->real_escape_string($_POST['day_of_week']);
    $start_time = $conn->real_escape_string($_POST['start_time']);
    $end_time = $conn->real_escape_string($_POST['end_time']);

    if ($start_time >= $end_time) {
    die("Hatalı saat aralığı: Başlangıç saati, bitiş saatinden önce olmalı.");
    }

    $sql = "INSERT INTO schedule (valve_id, day_of_week, start_time, end_time)
            VALUES ($valve_id, '$day_of_week', '$start_time', '$end_time')";

    if ($conn->query($sql) === TRUE) {
        header("Location: index.php?success=1");
        exit;
    } else {
        echo "Hata: " . $conn->error;
    }
} else {
    header("Location: index.php");
    exit;
}
?>
