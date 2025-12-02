<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Yedoks</title>
    <link rel="stylesheet" href="style.css">
    <link rel="shortcut icon" href="açu.ico" type="image/x-icon">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap" rel="stylesheet">


</head>
<body>
<?php
$conn = new mysqli("localhost", "root", "", "veriler");

$result = $conn->query("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1");

include 'komutver.php';

?>

<nav>
<div class="logo"></div>
<h1 class="headertext">Yedoks AÇÜ</h1>
</nav>
<div class="anlik"><p> Anlık</p></div>

<?php if ($row = $result->fetch_assoc()) { ?>
<div class="dashboard">
<div class="data">
    <p>Sıcaklık:<?php echo $row['temperature']; ?> °C</p>
    <p>Nem     :<?php echo $row['humidity']; ?> %</p> 
</div>
<div class="data">

    <p>ToprakNem :<?php echo $row['soil_moisture']?> %</p>
    <p>Yağmur : <?php echo $row['is_raining'] ? "Yok" : "Var" ?></p>

</div>
<div class="data">
    <p>Bölge 1</p>
    <form method="POST">
        <div class="but">
        <button id="tus1" type="submit" name="command" value="<?php echo $sondurum1?>"></button>
        </div>
    </form>
</div>
<div class="data">
    <p>Bölge 2</p>
    <form method="POST">
        <div class="but">
        <button id="tus2" type="submit" name="command" value="<?php echo $sondurum2?>"></button>
        </div>
    </form>
</div>

</div> <!--dashboard son -->

<div class="anlik"><p> Haftalık</p></div>

<form id="zamanlama" method="POST" action="schedule_ekle.php">
    <h2>Valf Zamanlama Ekle</h2>
    <label>Valf:</label>
    <select name="valve_id" required>
        <option value="1">Bölge 1</option>
        <option value="2">Bölge 2</option>
    </select><br>

    <label>Gün:</label>
    <select name="day_of_week" required>
        <option value="Monday">Pazartesi</option>
        <option value="Tuesday">Salı</option>
        <option value="Wednesday">Çarşamba</option>
        <option value="Thursday">Perşembe</option>
        <option value="Friday">Cuma</option>
        <option value="Saturday">Cumartesi</option>
        <option value="Sunday">Pazar</option>
    </select><br>

    <label>Başlangıç Saati:</label>
    <input type="time" name="start_time" required><br>

    <label>Bitiş Saati:</label>
    <input type="time" name="end_time" required><br>

    <button type="submit">Ekle</button>
</form> <!--haftalık programlama son -->

<?php } ?>

<style>
#tus1 {
    position:absolute;
    left: <?php echo ($sondurum1 == "valve_ac1") ? '130px' : '10px'; ?>;
    background-color:<?php echo ($sondurum1 == "valve_ac1") ? 'greenyellow' : 'red';?> ;
}
#tus2 {
    position:absolute;
    left: <?php echo ($sondurum2 == "valve_ac2") ? '130px' : '10px'; ?>;
    background-color:<?php echo ($sondurum2 == "valve_ac2") ? 'greenyellow' : 'red';?> ;
}
</style>
<script>
    document.getElementById('tus1').innerHTML = "<?php echo ($sondurum1 == "valve_ac1") ? "Açık" : "Kapalı";?>";
    document.getElementById('tus2').innerHTML = "<?php echo ($sondurum2 == "valve_ac2") ? "Açık" : "Kapalı";?>";
</script>


<?php include 'grafik.php';?>


<link rel="stylesheet" href="style.css">
</body>
</html>