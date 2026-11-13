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
            migrationBuilder.RenameColumn(
                name: "Phone",
                table: "Customers",
                newName: "PrimaryPhone");

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

            migrationBuilder.RenameColumn(
                name: "PrimaryPhone",
                table: "Customers",
                newName: "Phone");
        }
    }
}
