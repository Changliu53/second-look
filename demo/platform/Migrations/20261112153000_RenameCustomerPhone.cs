using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Platform.Data.Migrations
{
    /// <inheritdoc />
    public partial class RenameCustomerPhone : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Customers");

            migrationBuilder.AddColumn<string>(
                name: "PrimaryPhone",
                table: "Customers",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ServiceRegionId",
                table: "Wells",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddForeignKey(
                name: "FK_Wells_ServiceRegions_ServiceRegionId",
                table: "Wells",
                column: "ServiceRegionId",
                principalTable: "ServiceRegions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Wells_ServiceRegions_ServiceRegionId",
                table: "Wells");

            migrationBuilder.DropColumn(
                name: "ServiceRegionId",
                table: "Wells");

            migrationBuilder.DropColumn(
                name: "PrimaryPhone",
                table: "Customers");

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Customers",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);
        }
    }
}
