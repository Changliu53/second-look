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

            // Existing wells have no region yet, so the column is nullable and
            // they keep NULL. A later migration can make it required once every
            // well has been assigned a real region.
            migrationBuilder.AddColumn<int>(
                name: "ServiceRegionId",
                table: "Wells",
                type: "int",
                nullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Wells_ServiceRegions_ServiceRegionId",
                table: "Wells",
                column: "ServiceRegionId",
                principalTable: "ServiceRegions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
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
